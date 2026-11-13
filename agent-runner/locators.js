const LOCATOR_KEYS = ['signInLink', 'emailInput', 'continueButton', 'passwordInput', 'signInButton'];

/** JSON schema handed to Ollama so the model must answer in exactly this shape. */
const locatorSchema = {
  type: 'object',
  properties: {
    signInLink: { type: 'string' },
    emailInput: { type: 'string' },
    continueButton: { type: 'string' },
    passwordInput: { type: 'string' },
    signInButton: { type: 'string' },
    signedInUrlNot: { type: 'string' },
    signedInText: { type: 'string' },
  },
  required: [...LOCATOR_KEYS, 'signedInUrlNot', 'signedInText'],
};

const LOCATOR_RE =
  /^page\.(getByRole|getByLabel|getByText|getByPlaceholder|getByTestId)\([^;`\n]*\)(\.(first|last)\(\))?$/;
const FORBIDDEN = ['${', '=>', 'function', 'require', 'import', 'eval', 'process', 'constructor'];

/**
 * The model's text ends up inside generated JavaScript, so it is checked
 * strictly before it is written to disk. Throws with a message the model
 * can use to correct itself.
 */
function parseLocators(raw) {
  const text = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('Answer was not valid JSON.');
  }
  if (obj === null || typeof obj !== 'object') throw new Error('Answer was not a JSON object.');

  const problems = [];
  for (const key of LOCATOR_KEYS) {
    const v = obj[key];
    if (typeof v !== 'string' || !LOCATOR_RE.test(v.trim())) {
      problems.push(
        `${key} must be a single expression like page.getByRole('button', { name: /sign in/i }); got: ${JSON.stringify(v)}`,
      );
    } else if (FORBIDDEN.some((f) => v.includes(f))) {
      problems.push(`${key} contains a forbidden word or symbol.`);
    }
  }

  const urlNot = obj.signedInUrlNot;
  if (typeof urlNot !== 'string' || !/^[A-Za-z0-9|.\- ]{1,60}$/.test(urlNot)) {
    problems.push('signedInUrlNot may only contain letters, digits and | . - and be 1-60 characters.');
  }
  const signedText = obj.signedInText;
  if (typeof signedText !== 'string' || signedText.length > 60 || /["'\\`\n]/.test(signedText)) {
    problems.push('signedInText must be at most 60 characters with no quotes, backslashes or line breaks.');
  }

  if (problems.length) throw new Error(problems.join('\n'));

  return {
    signInLink: obj.signInLink.trim(),
    emailInput: obj.emailInput.trim(),
    continueButton: obj.continueButton.trim(),
    passwordInput: obj.passwordInput.trim(),
    signInButton: obj.signInButton.trim(),
    signedInUrlNot: obj.signedInUrlNot.trim(),
    signedInText: obj.signedInText.trim(),
  };
}

module.exports = { locatorSchema, parseLocators };
