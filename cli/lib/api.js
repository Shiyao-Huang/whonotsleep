// Minimal REST client (global fetch, Node >= 18).
export class ApiError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

export function normalizeServer(url) {
  let u = String(url || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

export async function api(serverUrl, method, path, { token, body, timeoutMs = 8000 } = {}) {
  const headers = { accept: 'application/json', 'user-agent': 'wns-cli' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(normalizeServer(serverUrl) + path, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const why = e?.name === 'TimeoutError' ? 'timeout' : (e?.cause?.code || e?.message || String(e));
    throw new ApiError(`network error: ${why}`, 0);
  }
  const text = await res.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && typeof data === 'object' && (data.error || data.message)) || `HTTP ${res.status}`;
    throw new ApiError(String(msg), res.status, data);
  }
  return data;
}

/** Shorthand bound to a config. */
export const authed = (cfg) => (method, path, body, opts = {}) =>
  api(cfg.serverUrl, method, path, { token: cfg.token, body, ...opts });

export const tzOffset = () => -new Date().getTimezoneOffset();
