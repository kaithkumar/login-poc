const HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5-coder:14b';
// Playwright snapshots are long. Ollama's default context is small, so raise it.
const NUM_CTX = Number(process.env.OLLAMA_NUM_CTX || 16384);

const stripThinking = (s) => (s || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();

/**
 * One chat call to a local Ollama server. Returns the assistant message
 * ({ content, tool_calls? }).
 *   messages: [{ role: 'system' | 'user' | 'assistant' | 'tool', content, ... }]
 *   opts.schema: JSON schema that forces structured output (cannot be combined with tools)
 *   opts.tools:  Ollama tool definitions, so the model can call them
 */
async function chatMessage(messages, opts = {}) {
  let res;
  try {
    res = await fetch(`${HOST}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: false,
        think: false, // qwen3: skip the long reasoning trace, we want the answer
        ...(opts.schema ? { format: opts.schema } : {}),
        ...(opts.tools && opts.tools.length ? { tools: opts.tools } : {}),
        options: { temperature: 0, num_ctx: NUM_CTX },
      }),
      signal: AbortSignal.timeout(10 * 60_000),
    });
  } catch (e) {
    throw new Error(
      `Cannot reach Ollama at ${HOST}. Is it running (ollama serve) and is "${MODEL}" pulled? (${e.message})`,
    );
  }
  if (!res.ok) {
    throw new Error(`Ollama returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  const msg = data.message || {};
  return { ...msg, content: stripThinking(msg.content) };
}

/** Plain text (or schema-constrained JSON text) answer. */
async function chat(messages, schema) {
  return (await chatMessage(messages, { schema })).content;
}

module.exports = { chat, chatMessage, MODEL };
