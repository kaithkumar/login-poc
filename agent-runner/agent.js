const { chatMessage, MODEL } = require('./ollama');

/** Keep only the latest tool results in full so the conversation fits the model's context. */
function pruneOldToolResults(messages, keep = 2) {
  const toolIdx = messages.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i >= 0);
  for (const i of toolIdx.slice(0, Math.max(0, toolIdx.length - keep))) {
    if (messages[i].content.length > 400) messages[i].content = '[earlier page state omitted to save space]';
  }
}

/**
 * Some models (qwen2.5-coder, for one) write the tool call as JSON text, such as
 * {"name": "browser_navigate", "arguments": {"url": "..."}}, instead of using Ollama's tool_calls
 * field. Accept that only when the WHOLE reply is a tool call (optionally in a code fence or in
 * <tool_call> tags) and every tool name is one we offered. Anything else is ordinary text.
 * The calls still go through browser.call, so every safety rule applies to them.
 */
function textToolCalls(content, toolNames) {
  if (!content) return [];
  const blocks = [];
  const rest = content.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, (_, inner) => {
    blocks.push(inner);
    return '';
  });
  if (!blocks.length) blocks.push(rest.trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim());

  const calls = [];
  for (const block of blocks) {
    let value;
    try {
      value = JSON.parse(block);
    } catch {
      return [];
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      const fn = item && typeof item === 'object' ? item.function || item : null;
      const name = fn && fn.name;
      if (!toolNames.includes(name)) return [];
      let args = fn.arguments !== undefined ? fn.arguments : fn.parameters;
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }
      calls.push({ function: { name, arguments: args && typeof args === 'object' ? args : {} } });
    }
  }
  return calls;
}

/** A sign-in form: a text field named like email / phone / username, or a password field. */
const SIGNIN_FORM_RE = /^\s*- textbox\s+"[^"]*(e-?mail|phone|user ?name|login|password)[^"]*"/im;
const hasSignInForm = (text) => SIGNIN_FORM_RE.test(text);

const shortArgs = (args) => {
  const s = JSON.stringify(args);
  return s.length > 90 ? s.slice(0, 87) + '...' : s;
};

/**
 * Tool-calling loop: the model drives the browser (through `browser.call`) until it
 * answers in plain text, or until maxSteps is used up.
 * Returns { text, observations } where observations lists every tool call and its result.
 */
async function exploreWithTools({ system, user, browser, maxSteps, requireSignInForm = true, log = console.log }) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const observations = [];
  let navigated = false;
  let nudges = 0;
  let formNudges = 0;
  let toolCallsMade = 0;
  let warnedTextCalls = false;
  const toolNames = browser.tools.map((t) => t.function.name);
  const done = (text) => {
    if (toolCallsMade === 0) {
      log(
        `      WARNING: "${MODEL}" never called a browser tool, so it never looked at the site. ` +
          'It may not support tool calling through Ollama. Try a tool-capable model, for example OLLAMA_MODEL=qwen3:8b.',
      );
    }
    return { text, observations };
  };

  for (let step = 1; step <= maxSteps; step++) {
    const msg = await chatMessage(messages, { tools: browser.tools });
    let calls = msg.tool_calls || [];
    let content = msg.content || '';
    if (!calls.length) {
      const fromText = textToolCalls(content, toolNames);
      if (fromText.length) {
        if (!warnedTextCalls) log(`      (note: "${MODEL}" writes tool calls as text; accepting them as tool calls)`);
        warnedTextCalls = true;
        calls = fromText;
        content = '';
      }
    }
    messages.push({ role: 'assistant', content, ...(calls.length ? { tool_calls: calls } : {}) });

    if (!calls.length) {
      if (!navigated && nudges < 2) {
        nudges++;
        messages.push({ role: 'user', content: 'You have not opened the site yet. Call browser_navigate with the site URL now.' });
        continue;
      }
      // The model wants to finish without ever having seen the sign-in form: send it back to look.
      if (requireSignInForm && formNudges < 2 && !observations.some((o) => hasSignInForm(o.text))) {
        formNudges++;
        messages.push({
          role: 'user',
          content:
            'You have not reached the sign-in form yet, so you cannot write test cases from what you saw. ' +
            'Call browser_find with text "sign in" (if there is no match, try "log in", then "account"). ' +
            'Copy the ref from the result and click it.',
        });
        continue;
      }
      if (msg.content) return done(msg.content);
      messages.push({ role: 'user', content: 'Reply with your final answer now.' });
      continue;
    }

    for (const call of calls) {
      const fn = call.function || {};
      let args = fn.arguments || {};
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }
      toolCallsMade++;
      log(`      [${step}] ${fn.name} ${shortArgs(args)}`);
      const result = await browser.call(fn.name, args);
      if (fn.name === 'browser_navigate' && !result.startsWith('Blocked')) navigated = true;
      observations.push({ tool: fn.name, args, text: result });
      messages.push({ role: 'tool', tool_name: fn.name, content: result });
    }
    pruneOldToolResults(messages);
  }

  messages.push({ role: 'user', content: 'Step limit reached. Write your final answer now, using only what you have seen.' });
  const last = await chatMessage(messages, {});
  return done(last.content);
}

/**
 * The most recent page states seen (latest per URL, at most `max`), as text for the
 * generator and healer. Only page states that include a snapshot are used.
 */
function latestPageStates(observations, max = 3) {
  const byUrl = new Map();
  for (const o of observations) {
    if (!o.text.includes('```yaml')) continue;
    const m = o.text.match(/Page URL:\s*(\S+)/);
    const key = m ? m[1] : `unknown-${byUrl.size}`;
    byUrl.delete(key); // re-insert so the newest state per URL is last
    byUrl.set(key, o.text);
  }
  return [...byUrl.values()].slice(-max).map((t, i) => `## Page state ${i + 1}\n${t}`).join('\n\n');
}

module.exports = { exploreWithTools, latestPageStates, hasSignInForm };