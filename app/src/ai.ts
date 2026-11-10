// AI access for the app.
// Default path: our own server's LLM proxy (POST {serverUrl}/api/ai/messages with the
// member Bearer token). The provider key and model live ONLY on the server — the app
// never sees them. Advanced option: a user's own Anthropic key (SecureStore) talks to
// api.anthropic.com directly.
// Also: "AI 叽里呱啦" — one short, cute, in-character chatter line for my pixel buddy.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Session, normalizeServer } from './api';
import { DerivedMember, Room, deriveScene } from './shared';
import { toolLabel } from './theme';

export const AI_KEY_STORE = 'wns:aiKey';
const AI_SETTINGS_KEY = 'wns:ai';
/** Model used ONLY with the advanced "own Anthropic key" override. The proxy picks its own model. */
export const OWN_KEY_DEFAULT_MODEL = 'claude-haiku-5-5';

/** `model` is only used with the own-key override ('' = OWN_KEY_DEFAULT_MODEL). */
export type AiSettings = { enabled: boolean; model: string };

export async function loadAiSettings(): Promise<AiSettings> {
  try {
    const s = await AsyncStorage.getItem(AI_SETTINGS_KEY);
    const v = s ? JSON.parse(s) : {};
    return { enabled: !!v.enabled, model: typeof v.model === 'string' ? v.model : '' };
  } catch {
    return { enabled: false, model: '' };
  }
}
export async function saveAiSettings(s: AiSettings): Promise<void> {
  await AsyncStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(s));
}
export async function loadAiKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(AI_KEY_STORE);
  } catch {
    return null;
  }
}
export async function saveAiKey(key: string): Promise<void> {
  const k = key.trim();
  if (k) await SecureStore.setItemAsync(AI_KEY_STORE, k);
  else await SecureStore.deleteItemAsync(AI_KEY_STORE);
}

// ------------------------------------------------------------- server status

export type AiStatus = { available: boolean; model: string };
const statusCache = new Map<string, { at: number; v: AiStatus }>();

/** GET /api/ai/status (cached 60s). Never throws: unreachable -> {available:false}. */
export async function fetchAiStatus(serverUrl: string, force = false): Promise<AiStatus> {
  const base = normalizeServer(serverUrl);
  const hit = statusCache.get(base);
  if (!force && hit && Date.now() - hit.at < 60_000) return hit.v;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(base + '/api/ai/status', { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    const j: any = await res.json().catch(() => null);
    const v: AiStatus = { available: !!(res.ok && j && j.available), model: (j && typeof j.model === 'string' && j.model) || '' };
    statusCache.set(base, { at: Date.now(), v });
    return v;
  } catch {
    return { available: false, model: '' };
  } finally {
    clearTimeout(timer);
  }
}

/** What the UI should show as "current model". */
export async function describeAiBackend(serverUrl: string): Promise<{ mode: 'server' | 'own'; model: string; available: boolean }> {
  const key = await loadAiKey();
  if (key) {
    const s = await loadAiSettings();
    return { mode: 'own', model: s.model || OWN_KEY_DEFAULT_MODEL, available: true };
  }
  const st = await fetchAiStatus(serverUrl);
  return { mode: 'server', model: st.model || '服务器模型', available: st.available };
}

// ---------------------------------------------------------- messages call

export type AiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: any }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
export type AiMessage = { role: 'user' | 'assistant'; content: string | AiContentBlock[] };
export type AiTool = { name: string; description: string; input_schema: Record<string, unknown> };
export type AiResponse = { content: any[]; stop_reason: string | null };

export class AiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function proxyErrorText(status: number, err: string): string {
  if (status === 429) return 'AI 小管家被问太多次啦，歇一分钟再来吧 (429)';
  if (status === 503) return 'AI 暂时不在线，服务器那边还没准备好 (503)';
  if (status === 401 || status === 403) return '身份失效了，请重新加入房间 (' + status + ')';
  if (status === 400) return 'AI 请求格式有点问题：' + (err || '400');
  if (status === 404) return '服务器还不支持 AI 功能 (404)';
  if (status >= 500) return 'AI 有点忙，稍后再试 (' + status + ')';
  return 'AI 出错：' + (err || 'HTTP ' + status);
}

/**
 * One Anthropic-Messages call. Uses the user's own key if one is saved
 * (advanced), otherwise our server proxy with the member token.
 */
export async function callMessages(opts: {
  session: Session;
  system?: string;
  messages: AiMessage[];
  tools?: AiTool[];
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<AiResponse> {
  const ownKey = await loadAiKey();
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener?.('abort', onAbort);
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, opts.timeoutMs ?? 45000);
  const body: Record<string, unknown> = {
    max_tokens: Math.min(1024, opts.maxTokens ?? 1024),
    messages: opts.messages,
  };
  if (opts.system) body.system = opts.system;
  if (opts.tools && opts.tools.length) body.tools = opts.tools;
  try {
    let res: Response;
    if (ownKey) {
      const s = await loadAiSettings();
      body.model = s.model || OWN_KEY_DEFAULT_MODEL;
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'x-api-key': ownKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } else {
      res = await fetch(normalizeServer(opts.session.serverUrl) + '/api/ai/messages', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { Authorization: 'Bearer ' + opts.session.token, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const err = typeof json?.error === 'string' ? json.error : json?.error?.message || json?.message || '';
      if (ownKey) {
        if (res.status === 401) throw new AiError(401, '你自己的 API Key 不对哦 (401)');
        if (res.status === 404) throw new AiError(404, '找不到这个模型：' + String(body.model));
        if (res.status === 429) throw new AiError(429, 'AI 被问太多次啦，稍后再试 (429)');
        if (res.status === 529 || res.status >= 500) throw new AiError(res.status, 'AI 有点忙，稍后再试');
        throw new AiError(res.status, 'AI 出错：' + (err || 'HTTP ' + res.status));
      }
      throw new AiError(res.status, proxyErrorText(res.status, String(err).slice(0, 120)));
    }
    if (!json || typeof json !== 'object') throw new AiError(502, 'AI 回了一串看不懂的东西 🤔');
    const content = Array.isArray(json.content)
      ? json.content
      : typeof json.content === 'string'
        ? [{ type: 'text', text: json.content }]
        : [];
    return { content, stop_reason: typeof json.stop_reason === 'string' ? json.stop_reason : null };
  } catch (e: any) {
    if (e instanceof AiError) throw e;
    if (e?.name === 'AbortError' || /abort/i.test(e?.message || '')) {
      if (timedOut) throw new AiError(0, 'AI 响应超时啦');
      throw new AiError(-1, '已停止');
    }
    if (/network request failed|failed to fetch/i.test(e?.message || '')) throw new AiError(0, '网络开小差了，连不上 AI');
    throw new AiError(0, e?.message || String(e));
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener?.('abort', onAbort);
  }
}

function hhmm(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function describe(m: DerivedMember, now: number): string {
  const mins = Math.max(0, Math.round((now - (m.statusSince || now)) / 60000));
  const parts = [`${m.name}（当地 ${hhmm(m.localHour)}）`];
  switch (m.pose) {
    case 'typing':
      parts.push(`正在用 ${toolLabel(m.tool)} 写代码${m.detail ? `（项目 ${m.detail}）` : ''}，已经 ${mins} 分钟`);
      break;
    case 'sitting':
      parts.push('坐在电脑前发呆');
      break;
    case 'empty':
      parts.push('离开了座位');
      break;
    case 'sleeping':
      parts.push(m.saidGoodnight ? '说了晚安，在睡觉' : '在睡觉');
      break;
    default:
      parts.push('不在线');
  }
  if (m.nightOwl) parts.push('【说了晚安却偷偷爬起来用 AI，被抓包了！】');
  if (m.badge === 'question') parts.push('（头上冒着大问号：谁还没睡？）');
  if (m.activeSay) parts.push(`刚说过：「${m.activeSay.text}」`);
  return parts.join('，');
}

export function buildPrompt(room: Room, meId: string, now = Date.now()): { system: string; user: string } {
  const d = deriveScene(room, now);
  const me = d.members.find((m) => m.id === meId);
  const others = d.members.filter((m) => m.id !== meId);
  const recent = (room.events || [])
    .slice(-6)
    .filter((e) => e.kind === 'say')
    .map((e) => `「${e.text}」`)
    .join(' ');
  const system =
    '你是一个 8-bit 像素小人，住在朋友们共享的深夜像素小房间里（游戏叫「谁还没睡」）。' +
    '大家用 AI 编程工具（Claude Code、Codex、Gemini 等）时，小人就坐到桌前敲键盘。' +
    '请以小人的口吻，说一句很短的、可爱的、叽里呱啦的碎碎念，可以吐槽熬夜的人、给同伴加油、催大家睡觉、或者感叹 AI。' +
    '要求：只输出这一句话本身，中文，不超过 20 个字，可以带 1 个 emoji，不要引号，不要解释。';
  const user =
    `房间「${d.name}」。\n我是：${me ? describe(me, now) : '新来的小人'}\n` +
    (others.length ? `其他人：\n${others.map((m) => '- ' + describe(m, now)).join('\n')}\n` : '房间里只有我一个人。\n') +
    (d.owls.length ? `夜猫子：${d.members.filter((m) => m.nightOwl).map((m) => m.name).join('、')}\n` : '') +
    (recent ? `最近大家说过：${recent}（别重复）\n` : '') +
    '现在说一句：';
  return { system, user };
}

function cleanLine(text: string): string {
  let s = (text || '').split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
  s = s.replace(/^["'“”「『]+|["'“”」』]+$/g, '').trim();
  const chars = Array.from(s);
  return chars.length > 28 ? chars.slice(0, 28).join('') : s;
}

export async function generateLine(opts: { session: Session; room: Room; meId?: string; now?: number }): Promise<string> {
  const { system, user } = buildPrompt(opts.room, opts.meId || opts.session.memberId, opts.now);
  const r = await callMessages({
    session: opts.session,
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 120,
    timeoutMs: 25000,
  });
  const text = (r.content || [])
    .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('');
  const line = cleanLine(text);
  if (!line) throw new Error('AI 没想好说什么 🤔');
  return line;
}

/** Random delay for the periodic chatter: 3–6 minutes. */
export function nextChatterDelay(): number {
  return (3 + Math.random() * 3) * 60_000;
}
