// Server-side LLM proxy for the in-app AI agent + chatter.
// The provider key/base URL/model come ONLY from env (WNS_AI_BASE_URL, WNS_AI_KEY,
// WNS_AI_MODEL), loaded by systemd from /etc/whonotsleep.env (mode 600). They are
// never sent to clients, never logged, never committed.

const MAX_TOKENS_CAP = 1024;
const MAX_MESSAGES = 60;
const MAX_TOOLS = 32;
const UPSTREAM_TIMEOUT_MS = 45_000;

export function loadAiConfig(env = process.env) {
  const baseUrl = (env.WNS_AI_BASE_URL || '').replace(/\/+$/, '');
  const key = env.WNS_AI_KEY || '';
  const model = env.WNS_AI_MODEL || 'glm-5.3-flash';
  return { baseUrl, key, model, available: !!(baseUrl && key) };
}

/** Validate + sanitize a client request into an upstream Anthropic Messages body. */
export function buildUpstreamBody(body, model) {
  const err = (m) => Object.assign(new Error(m), { status: 400 });
  const { system, messages, tools, tool_choice, max_tokens } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) throw err('messages must be a non-empty array');
  if (messages.length > MAX_MESSAGES) throw err(`at most ${MAX_MESSAGES} messages`);
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) throw err('message.role must be user|assistant');
    if (typeof m.content !== 'string' && !Array.isArray(m.content)) throw err('message.content must be string or array');
  }
  if (system != null && typeof system !== 'string' && !Array.isArray(system)) throw err('system must be string');
  if (tools != null && (!Array.isArray(tools) || tools.length > MAX_TOOLS)) throw err(`tools must be an array (<= ${MAX_TOOLS})`);
  const out = {
    model, // always the server's model — clients cannot pick
    max_tokens: Math.max(16, Math.min(MAX_TOKENS_CAP, Number(max_tokens) || 512)),
    messages,
    thinking: { type: 'disabled' },
  };
  if (system) out.system = system;
  if (tools && tools.length) {
    out.tools = tools.map((t) => {
      if (!t || typeof t.name !== 'string' || !t.input_schema) throw err('each tool needs name + input_schema');
      return { name: t.name, description: String(t.description || ''), input_schema: t.input_schema };
    });
    if (tool_choice && typeof tool_choice === 'object') out.tool_choice = tool_choice;
  }
  return out;
}

/** Strip provider-internal blocks (thinking etc.) and return a clean Anthropic-shaped response. */
export function cleanResponse(r) {
  const content = Array.isArray(r?.content) ? r.content.filter((b) => b && (b.type === 'text' || b.type === 'tool_use')) : [];
  return {
    id: r?.id || null,
    type: 'message',
    role: 'assistant',
    content,
    stop_reason: r?.stop_reason || 'end_turn',
    usage: r?.usage ? { input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens } : undefined,
  };
}

export async function callUpstream(cfg, upstreamBody, fetchImpl = fetch) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/v1/messages`, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': cfg.key,
        authorization: `Bearer ${cfg.key}`,
      },
      body: JSON.stringify(upstreamBody),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-json */ }
    if (!res.ok) {
      const e = new Error(`upstream ${res.status}`);
      e.status = res.status === 429 ? 429 : 502;
      e.publicMessage = res.status === 429 ? 'ai_rate_limited' : 'ai_upstream_error';
      throw e;
    }
    return cleanResponse(json);
  } catch (e) {
    if (e.name === 'AbortError') { const t = new Error('upstream timeout'); t.status = 504; t.publicMessage = 'ai_timeout'; throw t; }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
