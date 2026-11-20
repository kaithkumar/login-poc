const { spawnSync } = require('node:child_process');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { createInterface } = require('node:readline/promises');
const { chat, MODEL } = require('./ollama');
const { locatorSchema, parseLocators } = require('./locators');
const { startBrowser } = require('./browser');
const { exploreWithTools, latestPageStates, hasSignInForm } = require('./agent');

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

const agePrompt = (name) => readFileSync(`prompts/${name}.md`, 'utf-8').replace(/\n/g, ' ').trim();


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
  writeFileSync(LOCATORS_JSON, JSON.stringify(l, null, 2) + '\n');
  writeFileSync(PAGE_FILE, pageTemplate(l));
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
