/**
 * Local agent runner for the login POC. Uses Ollama (default: qwen3:8b), no cloud model.
 *
 *   npm run agent -- https://amazon.ai
 *
 * Pipeline: research (model drives Playwright MCP) -> plan -> HUMAN APPROVAL
 *           -> generate -> run -> heal (max 3) -> report.
 * The model browses the site itself through Playwright MCP tools. For code, it only
 * fills fixed templates (locators as validated JSON); it never writes free-form code.
 * The approval gate is enforced here, not left to the model.
 */
const { spawnSync } = require('node:child_process');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { createInterface } = require('node:readline/promises');
const { chat, MODEL } = require('./ollama');
const { locatorSchema, parseLocators } = require('./locators');
const { startBrowser } = require('./browser');
const { exploreWithTools, latestPageStates, hasSignInForm } = require('./agent');

const url = process.argv[2];
if (!url) {
  console.error('Usage: npm run agent -- <site url>');
  process.exit(1);
}

const PLAN = 'specs/login.plan.md';
const LOCATORS_JSON = 'pages/generated/locators.json';
const PAGE_FILE = 'pages/generated/LoginPage.js';
const SPEC_FILE = 'tests/generated/login.spec.js';
const DRAFT = 'Status: DRAFT - awaiting human approval';
const APPROVED = 'Status: APPROVED';
const MAX_HEAL = 3;
const BLOCKER_RE =
  /captcha|verification code|one[- ]time|\botp\b|unusual activity|not a robot|robot check|puzzle/i;

const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;
const agentPrompt = (name) => readFileSync(`agents/${name}.md`, 'utf8');

/** Never let credentials reach the model or the console. */
function redact(text) {
  let out = text;
  for (const secret of [email, password]) {
    if (secret) out = out.split(secret).join('<redacted>');
  }
  return out;
}

// ---------------------------------------------------------------- research (model + Playwright MCP)

const MAX_RESEARCH_STEPS = Number(process.env.MAX_STEPS || 20);

/** Run one tool-using agent session in a fresh browser. */
async function browse(agent, maxSteps, hint = '') {
  const browser = await startBrowser(url, { email, password });
  try {
    return await exploreWithTools({
      system: agentPrompt(agent),
      user: `Site URL: ${url}${hint ? `\n\n${hint}` : ''}`,
      browser,
      maxSteps,
    });
  } finally {
    await browser.close();
  }
}

/** True when the agent actually reached a page with the sign-in form (email, phone, username or password field). */
const reachedSignInForm = (observations) => observations.some((o) => hasSignInForm(o.text));

/** Save what the agent did, so a bad run can be diagnosed afterwards. */
function saveResearchLog(attempts) {
  const out = attempts
    .map(
      (a, i) =>
        `# Attempt ${i + 1}\n\n` +
        a.observations
          .map((o, n) => `## ${n + 1}. ${o.tool} ${JSON.stringify(o.args)}\n\n${o.text.slice(0, 700)}\n`)
          .join('\n') +
        `\n## Final answer\n\n${a.text}\n`,
    )
    .join('\n');
  writeFileSync('specs/research-log.md', redact(out));
}

const observedText = (observations) => observations.map((o) => o.text).join('\n');

// ---------------------------------------------------------------- plan + approval

function setStatus(line) {
  const lines = readFileSync(PLAN, 'utf8').split('\n');
  if (lines[0].startsWith('Status:')) lines[0] = line;
  else lines.unshift(line, '');
  writeFileSync(PLAN, lines.join('\n'));
}

async function humanApproval() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  rl.on('close', () => {
    closed = true;
  });
  try {
    for (;;) {
      console.log(`\n----- ${PLAN} -----\n${readFileSync(PLAN, 'utf8')}\n-----`);
      let answer = 'n';
      try {
        answer = (
          await rl.question('Approve this plan?  [y] approve   [r] I edited the file, show it again   [n] reject: ')
        )
          .trim()
          .toLowerCase();
      } catch {
        if (closed) answer = 'n'; // no human available: never auto-approve
      }
      if (answer === 'y') {
        setStatus(APPROVED);
        console.log('Plan approved.');
        return;
      }
      if (answer === 'n') {
        console.log('Plan not approved. Nothing was generated.');
        process.exit(0);
      }
    }
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------- generation

function requireApproved() {
  const first = readFileSync(PLAN, 'utf8').split('\n')[0].trim();
  if (first !== APPROVED) {
    throw new Error(`Plan is not approved (first line is "${first}"). Refusing to generate.`);
  }
}

async function askForLocators(system, user) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const raw = await chat(messages, locatorSchema);
    try {
      return parseLocators(raw);
    } catch (e) {
      lastError = e.message;
      messages.push(
        { role: 'assistant', content: raw },
        { role: 'user', content: `Your answer was rejected:\n${lastError}\nAnswer again with corrected JSON only.` },
      );
    }
  }
  throw new Error(`The model did not return valid locators after 3 tries:\n${lastError}`);
}

const pageTemplate = (l) => `const { expect } = require('@playwright/test');

/** GENERATED by agent-runner. All locators are in the one block below. */
class LoginPage {
  constructor(page) {
    this.page = page;
    // ---- locator block ----
    this.signInLink = ${l.signInLink};
    this.emailInput = ${l.emailInput};
    this.continueButton = ${l.continueButton};
    this.passwordInput = ${l.passwordInput};
    this.signInButton = ${l.signInButton};
    // -----------------------
  }

  async open() {
    await this.page.goto('/');
  }

  async goToSignIn() {
    await this.signInLink.click();
    await expect(this.emailInput).toBeVisible();
  }

  async login(email, password) {
    await this.emailInput.fill(email);
    // Two-step sign-in shows the password after "Continue"; skip it if both fields are already visible.
    if (!(await this.passwordInput.isVisible())) {
      await this.continueButton.click();
    }
    await expect(this.passwordInput).toBeVisible();
    await this.passwordInput.fill(password);
    await this.signInButton.click();
  }
}

module.exports = { LoginPage };
`;

const specTemplate = (l) => `const { expect, test } = require('@playwright/test');
const { LoginPage } = require('../../pages/generated/LoginPage');

const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;

test.describe('Login', () => {
  test.skip(!email || !password, 'Set TEST_EMAIL and TEST_PASSWORD to run this test');

  test('TC-001: registered user can sign in with valid credentials', async ({ page }) => {
    const login = new LoginPage(page);

    await test.step('Open the home page', async () => {
      await login.open();
    });
    await test.step('Go to the sign-in page', async () => {
      await login.goToSignIn();
    });
    await test.step('Enter valid credentials and submit', async () => {
      await login.login(email, password);
    });
    await test.step('Verify the user is signed in', async () => {
      await expect(login.passwordInput).toBeHidden();
      await expect(page).not.toHaveURL(/${l.signedInUrlNot}/i);${
        l.signedInText ? `\n      await expect(page.getByText(${JSON.stringify(l.signedInText)})).toBeVisible();` : ''
      }
    });
  });
});
`;

function writeProject(l) {
  mkdirSync('pages/generated', { recursive: true });
  mkdirSync('tests/generated', { recursive: true });
  writeFileSync(LOCATORS_JSON, JSON.stringify(l, null, 2) + '\n');
  writeFileSync(PAGE_FILE, pageTemplate(l));
  writeFileSync(SPEC_FILE, specTemplate(l));
}

// ---------------------------------------------------------------- run

function runTest() {
  const config = process.env.PW_CONFIG || 'playwright.config.js';
  const r = spawnSync('npx', ['playwright', 'test', SPEC_FILE, '-c', config, '--reporter=line'], {
    encoding: 'utf8',
    env: { ...process.env, BASE_URL: url },
    timeout: 5 * 60_000,
  });
  return { ok: r.status === 0, output: redact(`${r.stdout || ''}${r.stderr || ''}`) };
}

// ---------------------------------------------------------------- main

async function main() {
  console.log(`Model: ${MODEL}   Target: ${url}`);
  mkdirSync('specs', { recursive: true });

  console.log('\n[1/4] Planner agent is researching the site through Playwright MCP...');
  if (email) console.log('      (the agent reaches the password step via a placeholder; the model never sees your email or password)');
  const attempts = [await browse('planner', MAX_RESEARCH_STEPS)];
  if (!reachedSignInForm(attempts[0].observations)) {
    console.log('      The agent did not reach the sign-in form. Trying once more with a hint...');
    attempts.push(
      await browse(
        'planner',
        MAX_RESEARCH_STEPS,
        'Your previous attempt did not reach the sign-in form. The link may be named "Hello, sign in" or "Account & Lists". ' +
          'Call browser_find with text "sign in", copy the ref from its result, and click that ref.',
      ),
    );
  }
  const research = attempts[attempts.length - 1];
  saveResearchLog(attempts);
  if (!reachedSignInForm(research.observations)) {
    throw new Error(
      'The planner never reached the sign-in form, so any plan would be guesswork. Nothing was written for approval.\n' +
        '      See specs/research-log.md for what it did. Possible causes: the sign-in link has an unusual name,\n' +
        '      the site showed a bot check, or the model needs a larger MAX_STEPS or OLLAMA_NUM_CTX.',
    );
  }
  if (!research.text) throw new Error('The planner returned no test cases.');
  const states = latestPageStates(research.observations);
  if (!states) throw new Error('The planner never captured a page snapshot, so there is nothing to build locators from.');
  if (BLOCKER_RE.test(observedText(research.observations))) {
    console.log('      WARNING: a CAPTCHA or verification step may be present. Automation may not be possible.');
  }
  writeFileSync(PLAN, `${DRAFT}\n\n${redact(research.text)}\n`);

  console.log('\n[2/4] Waiting for human approval...');
  await humanApproval();

  console.log('\n[3/4] Generator agent is writing the locators for TC-001...');
  requireApproved();
  const approvedPlan = readFileSync(PLAN, 'utf8');
  let locators = await askForLocators(
    agentPrompt('generator'),
    `Approved plan:\n${approvedPlan}\n\nPage states seen during research:\n${states}`,
  );
  writeProject(locators);
  console.log(`      wrote ${PAGE_FILE}\n      wrote ${SPEC_FILE}`);

  if (!email || !password) {
    console.log('\n[4/4] TEST_EMAIL / TEST_PASSWORD are not set, so the test was not run.');
    console.log(`      Run it with:  TEST_EMAIL=... TEST_PASSWORD=... BASE_URL=${url} npx playwright test ${SPEC_FILE}`);
    return;
  }

  console.log('\n[4/4] Running the test...');
  let result = runTest();
  for (let attempt = 1; !result.ok && attempt <= MAX_HEAL; attempt++) {
    if (BLOCKER_RE.test(result.output)) {
      console.log('      Stopped: the failure looks like a CAPTCHA or verification step, which is not a locator problem.');
      break;
    }
    console.log(`      Test failed. Healer attempt ${attempt} of ${MAX_HEAL}: the Inspector agent looks at the site again...`);
    const fresh = await browse('inspector', 10);
    if (BLOCKER_RE.test(observedText(fresh.observations)) || /^BLOCKED/i.test(fresh.text)) {
      console.log('      Stopped: a CAPTCHA or verification step is showing.');
      break;
    }
    const freshStates = latestPageStates(fresh.observations);
    if (!freshStates) {
      console.log('      Stopped: the inspector could not capture any page state.');
      break;
    }
    const healed = await askForLocators(
      agentPrompt('healer'),
      `Current locators:\n${JSON.stringify(locators, null, 2)}\n\nFailure output (tail):\n${result.output.slice(-3000)}\n\nFresh page states:\n${freshStates}`,
    );
    if (JSON.stringify(healed) === JSON.stringify(locators)) {
      console.log('      The healer found nothing to change. The failure is probably not a locator problem.');
      break;
    }
    locators = healed;
    writeProject(locators);
    result = runTest();
  }

  console.log(result.ok ? '\nPASSED: TC-001 signs in successfully.' : `\nFAILED. Last output:\n${result.output.slice(-1500)}`);
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((e) => {
  console.error(`\nError: ${e.message}`);
  process.exit(1);
});
