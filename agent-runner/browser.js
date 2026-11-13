const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

/**
 * The only Playwright MCP tools the model may use. Left out on purpose:
 * browser_evaluate and browser_run_code_unsafe (run arbitrary code), file upload,
 * network and console readers, tab and screenshot tools.
 */
const ALLOWED_TOOLS = [
  'browser_navigate',
  'browser_navigate_back',
  'browser_snapshot',
  'browser_find',
  'browser_click',
  'browser_type',
  'browser_fill_form',
  'browser_press_key',
  'browser_wait_for',
  'browser_hover',
];
// After these, the page may have changed: make sure the model gets a fresh snapshot.
const STATE_CHANGING = new Set([
  'browser_navigate',
  'browser_navigate_back',
  'browser_click',
  'browser_type',
  'browser_fill_form',
  'browser_press_key',
  'browser_wait_for',
]);
const MAX_RESULT_CHARS = 6000;
const EMAIL_PLACEHOLDER = '{{TEST_EMAIL}}';
const PASSWORD_PLACEHOLDER = '{{TEST_PASSWORD}}';
const FAKE_EMAIL = 'research.user@example.com';

const textOf = (r) =>
  (r.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

/** Apply fn to every string inside a JSON-like value. */
function mapStrings(value, fn) {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]));
  }
  return value;
}

function containsString(value, needle) {
  let found = false;
  mapStrings(value, (s) => {
    if (s.includes(needle)) found = true;
    return s;
  });
  return found;
}


// ---- snapshot compaction -------------------------------------------------------------
// Real sites (Amazon, for example) produce snapshots of 50,000+ characters. A small model
// cannot use that, and cutting it at a fixed length can drop the sign-in link. So for big
// snapshots we keep (1) every line about sign-in / account / email / password / errors, then
// (2) the other interactive elements in page order, until the budget is used.
const INTERACTIVE_RE =
  /^\s*- (link|button|textbox|searchbox|combobox|checkbox|radio|switch|menuitem|tab|heading|alert|status)\b/;
const PRIORITY_RE =
  /sign.?in|log.?in|account|e-?mail|phone|username|password|continue|forgot|create|register|member|invalid|error|incorrect|required|captcha|verify|verification|robot/i;

function compactYaml(yaml, budget) {
  const lines = yaml
    .split('\n')
    .filter((l) => !/^\s*- \/url:/.test(l))
    .map((l) => l.replace(/\s*\[(cursor=pointer|active|level=\d+)\]/g, '').replace(/:\s*$/, ''));
  const keep = new Array(lines.length).fill(false);
  let used = 0;
  const take = (i) => {
    if (!keep[i] && used + lines[i].length + 1 <= budget) {
      keep[i] = true;
      used += lines[i].length + 1;
    }
  };
  lines.forEach((l, i) => PRIORITY_RE.test(l) && INTERACTIVE_RE.test(l) && take(i));
  lines.forEach((l, i) => PRIORITY_RE.test(l) && !INTERACTIVE_RE.test(l) && l.length < 160 && take(i));
  lines.forEach((l, i) => INTERACTIVE_RE.test(l) && take(i));
  const kept = lines.filter((_, i) => keep[i]).map((l) => l.replace(/^\s+/, ''));
  return `${kept.join('\n')}\n[compacted: ${kept.length} of ${lines.length} lines kept; use browser_find to look for something specific]`;
}

/** If the result holds a very large yaml snapshot, replace it with the compact form. */
function compactResult(text, budget) {
  const m = text.match(/```yaml\n([\s\S]*?)\n```/);
  if (!m || m[1].length <= budget) return text;
  return text.replace(m[0], '```yaml\n' + compactYaml(m[1], budget) + '\n```');
}

// Element refs from a page state look like e12 or f1e3 (inside a frame).
const REF_RE = /^(?:f\d+)?e\d+$/;
const NEEDS_TARGET = new Set(['browser_click', 'browser_type', 'browser_hover']);
const refProblem = (name, args) => {
  let targets = [];
  if (NEEDS_TARGET.has(name)) targets = [args.target];
  else if (name === 'browser_fill_form' && Array.isArray(args.fields)) targets = args.fields.map((f) => f && f.target);
  for (const t of targets) {
    if (typeof t !== 'string' || !REF_RE.test(t)) {
      return `Blocked: target ${JSON.stringify(t)} is not an element ref. A ref looks like e12 or f1e3 and must be copied exactly from the latest page state. XPath, CSS, text and URLs are not valid targets. If you cannot see the element, call browser_find with a word from its name (for example "sign in"); it is not case-sensitive and returns the ref.`;
    }
  }
  return null;
};

/**
 * Starts Playwright MCP and returns a small wrapper for the model's tool calls.
 * The wrapper (not the model) enforces the rules:
 *  - only ALLOWED_TOOLS
 *  - browser_navigate only to the target site (and its subdomains)
 *  - the real password can never be typed; the real email is only ever typed through
 *    the {{TEST_EMAIL}} placeholder, so the model never sees either value
 */
async function startBrowser(targetUrl, { email, password } = {}) {
  const cli = path.join(path.dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js');
  const args = [cli, '--isolated'];
  if (process.env.HEADLESS === '1') args.push('--headless');
  if (process.env.MCP_NO_SANDBOX === '1') args.push('--no-sandbox');
  if (process.env.MCP_BROWSER) args.push('--browser', process.env.MCP_BROWSER);
  if (process.env.PW_EXECUTABLE_PATH) args.push('--executable-path', process.env.PW_EXECUTABLE_PATH);

  const client = new Client({ name: 'login-poc', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StdioClientTransport({ command: process.execPath, args }));

  const { tools: mcpTools } = await client.listTools();
  const tools = mcpTools
    .filter((t) => ALLOWED_TOOLS.includes(t.name))
    .map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: (t.description || '').slice(0, 200),
        // Ollama does not need these JSON-schema extras.
        parameters: JSON.parse(
          JSON.stringify(t.inputSchema || { type: 'object', properties: {} }, (k, v) =>
            k === '$schema' || k === 'additionalProperties' ? undefined : v,
          ),
        ),
      },
    }));

  const targetHost = new URL(targetUrl).hostname.toLowerCase();
  const baseHost = targetHost.replace(/^www\./, '');
  const hostAllowed = (host) => host === targetHost || host === baseHost || host.endsWith(`.${baseHost}`);

  const redact = (text) => {
    let out = text;
    for (const secret of [email, password]) {
      if (secret) out = out.split(secret).join('<redacted>');
    }
    return out;
  };

  function finish(text) {
    let out = text.replace(/### Ran Playwright code[\s\S]*?(?=\n### |$)/, '').trim();
    out = redact(out);
    out = compactResult(out, MAX_RESULT_CHARS - 600);
    if (out.length > MAX_RESULT_CHARS) {
      out = out.slice(0, MAX_RESULT_CHARS) + '\n[...page state truncated...]';
    }
    return out;
  }

  async function call(name, rawArgs) {
    if (!ALLOWED_TOOLS.includes(name)) {
      return `Blocked: the tool "${name}" is not available. Use only: ${ALLOWED_TOOLS.join(', ')}.`;
    }

    if (containsString(rawArgs, PASSWORD_PLACEHOLDER) || (password && containsString(rawArgs, password))) {
      return 'Blocked: never type a password during research. Stop before the password is needed.';
    }
    if (name === 'browser_navigate') {
      let u;
      try {
        u = new URL(String(rawArgs.url || ''));
      } catch {
        return 'Blocked: browser_navigate needs a full URL such as https://example.com/.';
      }
      if (!/^https?:$/.test(u.protocol) || !hostAllowed(u.hostname.toLowerCase())) {
        return `Blocked: ${u.hostname} is outside the target site (${targetHost}). Stay on the target site.`;
      }
    }

    const problem = refProblem(name, rawArgs);
    if (problem) return problem;

    // The model writes {{TEST_EMAIL}}; the real address (or a fake one) is filled in here.
    let args = mapStrings(rawArgs, (s) => s.split(EMAIL_PLACEHOLDER).join(email || FAKE_EMAIL));
    // Small models ask for depth-1 or boxed snapshots that hide everything. Always take a full one.
    if (name === 'browser_snapshot') args = {};

    let result;
    try {
      result = await client.callTool({ name, arguments: args });
    } catch (e) {
      return finish(`Error: ${e.message}`);
    }
    let text = textOf(result);
    if (STATE_CHANGING.has(name) && !result.isError && !text.includes('```yaml')) {
      try {
        // Action results only link to a snapshot file. Fetch it so the model sees the page now.
        const snap = textOf(await client.callTool({ name: 'browser_snapshot', arguments: {} }));
        const at = snap.indexOf('### Snapshot');
        text =
          text
            .replace(/### Snapshot\n- \[Snapshot\]\([^)]*\)\n?/, '')
            .replace(/### Events[\s\S]*?(?=\n### |$)/, '')
            .trim() +
          '\n' +
          (at >= 0 ? snap.slice(at) : snap);
      } catch {
        /* the model can still call browser_snapshot itself */
      }
    }
    return finish(text);
  }

  return { tools, call, close: () => client.close().catch(() => {}) };
}

module.exports = { startBrowser };
