const ALLOWED_ACTIONS = [
  'navigate',
  'click',
  'select_option',
  'fill',
  'verify_text',
  'verify_visible',
  'verify_url_not',
];

const NEEDS_LOCATOR = new Set(['click', 'select_option', 'fill', 'verify_text', 'verify_visible']);
const NEEDS_VALUE = new Set(['navigate', 'select_option', 'fill', 'verify_text', 'verify_url_not']);
const LOCATOR_RE = /^page\.(getByRole|getByLabel|getByText|getByPlaceholder|getByTestId)\([^;`\n]*\)(\.(first|last)\(\))?$/;
const LOCATOR_FORBIDDEN = ['${', '=>', 'function', 'require', 'import', 'eval', 'process', 'constructor'];
const STEP_ID_RE = /^S\d{2}$/;

const STEP_SCHEMA = {
  type: 'object',
  properties: {
    task: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            action: { type: 'string', },
            locator: { type: 'string' },
            value: { type: 'string' },
       },
       required: ['id','description', 'action','locator', 'value' ],
     }
   },
   checkoutUrlNot: { type: 'string' },
   cardConfirmText: { type: 'string' }, 
  },
  required: ['task', 'steps', 'checkoutUrlNot', 'cardConfirmText'],
};

function parseSteps(raw){
    const text = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();

    let obj;
    try {
        obj = JSON.parse(text);
    } catch {
        throw new Error('Answer was not valid JSON.');
    }
    if (obj === null || typeof obj !== 'object') throw new Error('Answer was not a JSON object.');

    const problems = [];
    if (typeof obj.task !== 'string' || obj.task.trim().length === 0) {
        problems.push('task must be a non empty string.');
    }

    const urlNot = obj.checkoutUrlNot;
    if (typeof urlNot !== 'string' || !/^[A-Za-z0-9|.\-_ ]{1,80}$/.test(urlNot)) {
        problems.push('checkoutUrlNot may only contain letters, digits and | . - and be 1-80 characters.');
    }
    if (typeof obj.cardConfirmText !== 'string' || obj.cardConfirmText.length > 80 ) {
        problems.push('cardConfirmText may only contain up to 80 characters.');
    }

    if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
        problems.push('steps must be a non empty array.');
        throw new Error(problems.join('\n'));
    }

    const seenIDs = new Set();
    obj.steps.forEach((step, idx) => {
        const loc = `steps[${idx}] (id: ${step && step.id})`;

        if (!step || typeof step !== 'object') {
            problems.push(`${loc} is not an object.`);
            return;
        }

        if(!STEP_ID_RE.test(step.id)) {
            problems.push(`${loc} has invalid id. Must be like S01, S02, etc.`);
        }else if (seenIDs.has(step.id)) {
            problems.push(`${loc} has duplicate id.`);
        }else{
            seenIDs.add(step.id);
        }

        if (typeof step.description !== 'string' || step.description.trim().length === 0) {
            problems.push(`${loc} description must be a non empty string.`);
        }

        if (!ALLOWED_ACTIONS.includes(step.action)) {
            problems.push(`${loc} action must be one of: ${ALLOWED_ACTIONS.join(', ')}. Got: ${JSON.stringify(step.action)}`);
            return;
        }

        if(NEEDS_LOCATOR.has(step.action)) {
            const l = (step.locator || '').trim();
            if (!LOCATOR_RE.test(l)) {
                problems.push(`${loc} locator must be a single expression like page.getByRole('button', { name: /sign in/i }); got: ${JSON.stringify(step.locator)}`);
            } else if (LOCATOR_FORBIDDEN.some((f) => l.includes(f))) {
                problems.push(`${loc} locator contains a forbidden word or symbol.`);
            }
        }else{
            if(step.locator !== ''){
                problems.push(`${loc} locator must be empty for action ${step.action}.`);
            }
        }

        if (NEEDS_VALUE.has(step.action)) {
            if (typeof step.value !== 'string' || step.value.trim().length === 0) {
                problems.push(`${loc} value must be a non empty string for action ${step.action}.`);
            }
        }
    });

    if(problems.length) throw new Error(problems.join('\n'));

    return {
        task: obj.task.trim(),
        steps: obj.steps.map(s => ({
            id: s.id,
            description: s.description.trim(),
            action: s.action,
            locator: (s.locator || '').trim(),
            value: (s.value || '').trim(),
        })),
        checkoutUrlNot: obj.checkoutUrlNot.trim(),
        cardConfirmText: obj.cardConfirmText.trim(),
    };

}
module.exports = { STEP_SCHEMA, parseSteps, ALLOWED_ACTIONS, NEEDS_LOCATOR, NEEDS_VALUE };