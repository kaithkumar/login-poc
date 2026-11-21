const { spawnSync } = require('node:child_process');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { createInterface } = require('node:readline/promises');
const { chat, MODEL } = require('./ollama');
const { stepsSchema, parseSteps } = require('./steps-schema');
const { startBrowser } = require('./browser');
const { exploreWithTools, latestPageStates } = require('./agent');

function parseArgs(argv) {
    const args = {};
    for (let i=0; i<argv.length; i++) {
        if (argv[i] === "--url" && argv[i+1]) {
            args.url = argv[i+1];
            continue;
        }
        if (argv[i] === "--task" && argv[i+1]) {
            args.task = argv[i+1];
            continue;
        }
        if(!argv[i].startsWith("--") && !args.url) {
            args.url = argv[i];
        }
    }
    return args;
}

const { url, task } = parseArgs(process.argv.slice(2));

if (!url) {
    console.error('Usage: node ecommerce-run.js <url> --task "<category> <subcategory> <price rule> <product> <checkout>"');
    process.exit(1);
}

if (!task) {
    console.error('Usage: node ecommerce-run.js <url> --task "<category> <subcategory> <price rule> <product> <checkout>"');
    process.exit(1);
}

const PLAN = 'specs/ecommerce.plan.md';
const STEPS_JSON = 'pages/generated/ecommerce-steps.json';
const PAGE_FILE = 'pages/generated/EcommercePage.js';
const SPECS_FILE = 'tests/generated/ecommerce.spec.js';
const DRAFT='STATUS: DRAFT - awaiting human approval';
const APPROVED= 'STATUS: APPROVED';
const MAX_HEAL = 3;
const MAX_RESEARCH_STEPS = 5;
const BLOCKER_RE =   /captcha|verification code|one[- ]time|\botp\b|unusual activity|not a robot|robot check|puzzle|age.?gate|must.*sign.?in|login.?required/i;

const agentPrompt = (name) => readFileSync(`agents/${name}.md`, 'utf-8').replace(/\n/g, ' ').trim();


function pageTemplate(stepObj){
    const { steps, checkoutUrlNot, cardConfirmText } = stepObj;

    const stepLines = steps.map((s) => {
        switch (s.action) {
            case 'navigate':
                return ` // ${s.id}: ${s.description}\nawait page.goto(${JSON.stringify(s.value)});`;
            case 'click':
                return ` // ${s.id}: ${s.description}\nawait ${s.locator}.click();`;
            case 'select_option':
                return ` // ${s.id}: ${s.description}\nawait ${s.locator}.selectOption(${JSON.stringify(s.value)});`;
            case 'fill':
                return ` // ${s.id}: ${s.description}\nawait ${s.locator}.fill(${JSON.stringify(s.value)});`;
            case 'verify_text':
                return ` // ${s.id}: ${s.description}\nawait expect(${s.locator}).toHaveText(${JSON.stringify(s.value)});`;
            case 'verify_visible':
                return ` // ${s.id}: ${s.description}\nawait expect(${s.locator}).toBeVisible();`;
            case 'verify_url_not':
                return ` // ${s.id}: ${s.description}\nexpect(page.url()).not.toContain(${JSON.stringify(s.value)});`;
            default:
                return ` // ${s.id}: ${s.description}\n [Unknown action: ${s.action}]`;
        }
    })

return `const { test, expect } = require('@playwright/test');

class EcommercePage {
    constructor(page) {
        this.page = page;
    }

    get steps() {
        return $JSON.stringify(${JSON.stringify(steps.map((s) => ({ id: s.id, description: s.description  })),
        null,
        4,
    )};
   }

   async runStep(stepId){
   switch(stepId){
   ${steps.map((s,i) => ` case ${JSON.stringify(s.id)}: ${stepLines[i]}\n break;`).join('\n')}}
   default:
   throw new Error('Unknown step ID: ' + stepId);
   }
   }
}
   modeule.exports = {EcommercePage};
   `.replace('${steps.map', '// (steps map generated above)');
}

function specTemplate (stepsObj) {
    const safeTask = stepsObj.task.replace(/[^a-zA-Z0-9]/g, '');
     return `const { expect, test } = require('@playwright/test');
const { LoginPage } = require('../../pages/generated/EcommercePage');;

test.describe('E-commerce: ${safeTask}', () => {

  test('TC-001: purchase cheapest item via category navigation', async ({ page }) => {
    const ep = new EcommercePage(page);

    for (const { id, description } of ep.steps) {
      await test.step(\`\${id}: \${description}\`, async () => {
        await ep.runStep(id);
      });
    }
  });
});
`;
}

function writeProject(l) {
  mkdirSync('pages/generated', { recursive: true });
  mkdirSync('tests/generated', { recursive: true });
  writeFileSync(STEPS_JSON, JSON.stringify(l, null, 2) + '\n');
  writeFileSync(PAGE_FILE, buildPageFile(l));
  writeFileSync(SPEC_FILE, specTemplate(l));
}


function buildPageFile(stepsObj) {
    const { steps, task,  checkoutUrlNot, cardConfirmText } = stepsObj;
    const caseBlocks = steps.map((s) => {
        let body;
        switch (s.action) {
            case 'navigate':
                body = `await this.page.goto(${JSON.stringify(s.value)});`;
                break;
            case 'click':
                body = `await ${s.locator}.click();`;
                break;
            case 'select_option':
                body = `await ${s.locator}.selectOption(${JSON.stringify(s.value)});`;
                break;
            case 'fill':
                body = `await ${s.locator}.fill(${JSON.stringify(s.value)});`;
                break;
            case 'verify_text':
                body = `await expect(${s.locator}).toHaveText(${JSON.stringify(s.value)});`;
                break;
            case 'verify_visible':
                body = `await expect(${s.locator}).toBeVisible();`;
                break;
            case 'verify_url_not':
                body = `expect(this.page.url()).not.toContain(${JSON.stringify(s.value)});`;
                break;
            default:
                body = ` // 'Unknown action: ${s.action}';`;
        }
        return `case ${JSON.stringify(s.id)}:\n  ${body}\n  break;`;
    });

    const stepsMetaJson = JSON.stringify(steps.map((s) => ({ id: s.id, description: s.description })), null, 6);

    return `const { expect } = require('@playwright/test');
class EcommercePage {
    constructor(page) {
        this.page = page;
    }

    get steps() {
        return ${stepsMetaJson};
    }

    async runStep(stepId) {
        switch (stepId) {
            ${caseBlocks.join('\n')}
            default:
                throw new Error('Unknown step ID: ' + stepId);
        }
    }
}
module.exports = { EcommercePage };
`;
}   

async function browse(agent, maxSteps, hint='') {
    const browser = await startBrowser(url, {});
    try {
        return await exploreWithTools({
            system: agentPrompt(agent),
            user: `Site URL: ${url}\nTask: ${task}\n${ hint ? `Hint: ${hint}\n` : '' }`,
            browser,
            maxSteps,
            requireSignInForm: false,
        });
    }
    finally {
        await browser.close();
    }
    }   

function saveResearchLog(attempts) {
    const out = attempts.map((a, i) => `=== Attempt ${i + 1} \n\n` +
        a.observations.map((o, n) => `--- ## ${n + 1}  ${o.tool} ${JSON.stringify(o.args)}\n\n${o.text.slice(0, 700)}\n`)
        .join('\n') +
        `\n\nFinal answer:\n\n${a.text}\n`).join('\n');
        writeFileSync('specs/ecommerce-research-log.md', out);
}


const observedText = (observations) => observations.map((o) => o.text).join('\n\n');

function reachedProductListing(observations) {
    return observations.some((o) => /product|listing|results|items found|sort|filter/i.test(o.text));
}

function setStatus(line) {
    const lines = readFileSync(PLAN, 'utf-8').split('\n');
    if (lines[0].startsWith("Status:")) {
        lines[0] = line;
    }
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

function requireApproved() {
  const first = readFileSync(PLAN, 'utf8').split('\n')[0].trim();
  if (first !== APPROVED) {
    throw new Error(`Plan is not approved (first line is "${first}"). Refusing to generate.`);
  }
}

async function askForSteps(system, user)  { 
    const messages = [
        {role: 'system', content: system},
        {role: 'user', content: user},
    ];
    let lastError = '';
    for(let attempt=1; attempt <=3; attempt++)
    {
        const raw = await chat(messages, stepsSchema)
        try{
            return parseSteps(raw);
        }
        catch(e){
            lastError = e.message
            messages.push(
                {role: 'assistant', content: raw},
                {role: 'user', content: `Your answer was rejected:\n${lastError}\nAnswer again with corrected JSON only.`},

            );
        }
    }
    throw new Error(`The model did not return valid steps after 3 tries:"\n{lastError}`)
}


function runTest() {
  const config = process.env.PW_CONFIG || 'playwright.config.js';
  const r = spawnSync('npx', ['playwright', 'test', SPEC_FILE, '-c', config, '--reporter=line'], {
    encoding: 'utf8',
    env: { ...process.env, BASE_URL: url },
    timeout: 5 * 60_000,
  });
  return { ok: r.status === 0, output: `${r.stdout || ''}${r.stderr || ''}` };
}


async function main() {
  console.log(`Model: ${MODEL}   Target: ${url}  Task: ${task}`);
  mkdirSync('specs', { recursive: true });

  console.log('\n[1/4] Planner agent is researching the site through Playwright MCP...');
  const attempts = [await browse('ecommerce-planner', MAX_RESEARCH_STEPS)];
  if (!reachedProductListing(attempts[0].observations)) {
    console.log('      The agent did not reach a product listing. Trying again with a navigation hint...');
    attempts.push(
      await browse(
        'ecommerce-planner',
        MAX_RESEARCH_STEPS,
        'Your previous attempt did not reach product listing page.' +
          `Try browser_find with category keyword from the task (e.g. "${task.split('<')[0].trim()}")`,+
          'copy the ref and click it. then look for the subcategory'
      ),
    );
  }

  const research = attempts[attempts.length - 1];
  saveResearchLog(attempts);
  if (!reachedProductListing(research.observations)) {
    throw new Error(
      'The planner never reached a product listing page, so any plan would be guess work.\n' +
        '      See specs/ecommerce-research-log.md for what it did.\n' +
        '      Possible causes: navigation labels differ from the task, the site uses a login wall,\n' +
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

  console.log('\n[3/4] Generator agent is building the step list');
  requireApproved();


  const approvedPlan = readFileSync(PLAN, 'utf8');


  let stepsObj = await askForSteps(
    agentPrompt('ecommerce-generator'),
    `Approved plan:\n${approvedPlan}\n\nPage states seen during research:\n${states}`,
  );
  writeProject(stepsObj);
  console.log(`      wrote ${PAGE_FILE}\n      wrote ${SPEC_FILE}`);


  console.log('\n[4/4] Running the test...');
  let result = runTest();

  for (let attempt = 1; !result.ok && attempt <= MAX_HEAL; attempt++) {
    if (BLOCKER_RE.test(result.output)) {
      console.log('      Stopped: the failure looks like a CAPTCHA or verification step, which is not a locator problem.');
      break;
    }
    console.log(`      Test failed. Healer attempt ${attempt} of ${MAX_HEAL}: the Inspector agent looks at the site again...`);

    const failingStepHint = extractFailingStepHint(result.output, stepsObj)
    const fresh = await browse('ecommerce-inspector', 15, failingStepHint);

    if (BLOCKER_RE.test(observedText(fresh.observations)) || /^BLOCKED/i.test(fresh.text)) {
      console.log('      Stopped: a CAPTCHA or verification step is showing.');
      break;
    }

    const freshStates = latestPageStates(fresh.observations);
    if (!freshStates) {
      console.log('      Stopped: the inspector could not capture any page state.');
      break;
    }
    const healed = await askForSteps(
      agentPrompt('ecommerce-healer'),
      `Current locators:\n${JSON.stringify(locators, null, 2)}\n\nFailure output (tail):\n${result.output.slice(-3000)}\n\nFresh page states:\n${freshStates}`,
    );
    if (JSON.stringify(healed) === JSON.stringify(locators)) {
      console.log('      The healer found nothing to change. The failure is probably not a locator problem.');
      break;
    }
    stepsObj = healed;
    writeProject(locators);
    result = runTest();
  }


  console.log(result.ok ? '\nPASSED: TC-001 signs in successfully.' : `\nFAILED. Last output:\n${result.output.slice(-1500)}`);
  process.exitCode = result.ok ? 0 : 1;
}

function extractFailingStepHint(output, stepsObj){
    const idMatch = output.match(/\b(S\d{2})\b/);
    if(idMatch){
        const failId = idMatch[1];
        const step = stepsObj.steps.find((s)=> s.id ===failId)
        if(step){
            return(
                `   The failing step is ${step.id}: "${step.description}" (action: ${step.action}).\n` +
                `   Navigate to the site, replay steps up to just before ${step.id},  `
                `   then capture a screenshot of the page where the failure occurs.  `
            )
        }
    }
    
  return 'Navigate to the site and replay the shopping journey upto the point of failure. capture a snapshot'
}

main().catch((e) => {
    console.error(`\nError: ${e.message}`);
    process.exit(1);
})