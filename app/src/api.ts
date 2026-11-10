// HTTP + WebSocket client for the WhoNotSleep server (API in shared/protocol.js).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { Avatar, DEFAULT_SERVER, Room } from './shared';

export type Session = { serverUrl: string; roomCode: string; token: string; memberId: string };
export type Profile = { name: string; avatar: Avatar };

const SESSION_KEY = 'wns:session';
const PROFILE_KEY = 'wns:profile';
const SERVER_KEY = 'wns:serverUrl';

// ------------------------------------------------------------------ storage

async function readJSON<T>(key: string): Promise<T | null> {
  try {
    const s = await AsyncStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

export async function loadSession(): Promise<Session | null> {
  const s = await readJSON<Session>(SESSION_KEY);
  return s && s.token && s.roomCode && s.memberId ? { ...s, serverUrl: s.serverUrl || DEFAULT_SERVER } : null;
}
export async function saveSession(s: Session): Promise<void> {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(s));
}
export async function clearSession(): Promise<void> {
  await AsyncStorage.removeItem(SESSION_KEY);
}
export async function loadProfile(): Promise<Profile | null> {
  return readJSON<Profile>(PROFILE_KEY);
}
export async function saveProfile(p: Profile): Promise<void> {
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}
export async function loadServerUrl(): Promise<string> {
  return (await AsyncStorage.getItem(SERVER_KEY).catch(() => null)) || DEFAULT_SERVER;
}
export async function saveServerUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(SERVER_KEY, normalizeServer(url));
}

export function normalizeServer(url: string): string {
  let u = (url || '').trim().replace(/\/+$/, '');
  if (!u) return DEFAULT_SERVER;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}
export function tzOffset(): number {
  return -new Date().getTimezoneOffset();
}

// --------------------------------------------------------------------- REST

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Human friendly Chinese message for any thrown error. */
export function errText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 404) return '找不到这个房间 (404)';
    if (e.status === 401 || e.status === 403) return '身份失效了，请重新加入 (' + e.status + ')';
    if (e.status === 409) return '房间满员啦（最多 6 个人）';
    if (e.status === 400) return '请求有误：' + (e.message || '参数不对');
    if (e.status === 429) return '太快啦，歇一会儿再试';
    return e.message || '服务器出错 (' + e.status + ')';
  }
  const msg = (e as any)?.message || String(e);
  if (/network|failed to fetch|timeout|abort/i.test(msg)) return '网络开小差了，连不上服务器';
  return msg;
}

async function request<T>(
  serverUrl: string,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  timeoutMs = 12000,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(normalizeServer(serverUrl) + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) throw new ApiError(res.status, (json && (json.error || json.message)) || text.slice(0, 120));
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

type JoinResult = { room: Room; memberId: string; token: string };
type Ok = { ok: boolean };

export const api = {
  health: (serverUrl: string) => request<unknown>(serverUrl, 'GET', '/healthz', undefined, undefined, 6000).then(() => true),
  createRoom: (serverUrl: string, name: string, profile: Profile) =>
    request<JoinResult>(serverUrl, 'POST', '/api/rooms', {
      name,
      member: { name: profile.name, avatar: profile.avatar, tzOffset: tzOffset() },
    }),
  joinRoom: (serverUrl: string, code: string, profile: Profile) =>
    request<JoinResult>(serverUrl, 'POST', `/api/rooms/${encodeURIComponent(code.toUpperCase())}/join`, {
      member: { name: profile.name, avatar: profile.avatar, tzOffset: tzOffset() },
    }),
  getRoom: (serverUrl: string, code: string) =>
    request<{ room: Room }>(serverUrl, 'GET', `/api/rooms/${encodeURIComponent(code)}`).then((r) => r.room),
  sceneUrl: (s: Session, layout: 'room' | 'small' | 'wide' = 'room', scale = 4) =>
    `${normalizeServer(s.serverUrl)}/api/rooms/${s.roomCode}/scene.png?layout=${layout}&scale=${scale}&focus=${s.memberId}`,
  linkCode: (s: Session) =>
    request<{ linkCode: string; expiresAt: number }>(s.serverUrl, 'POST', '/api/me/linkcode', {}, s.token),
  link: (serverUrl: string, linkCode: string) =>
    request<{ token: string; memberId: string; roomCode: string; name: string }>(serverUrl, 'POST', '/api/link', { linkCode }),
  report: (s: Session, status: string, tool: string | null = null, detail: string | null = null) =>
    request<Ok>(s.serverUrl, 'POST', '/api/me/report', { status, tool, detail, tzOffset: tzOffset() }, s.token),
  goodnight: (s: Session) => request<Ok>(s.serverUrl, 'POST', '/api/me/goodnight', {}, s.token),
  morning: (s: Session) => request<Ok>(s.serverUrl, 'POST', '/api/me/morning', {}, s.token),
  emote: (s: Session, kind: string, to?: string | null) =>
    request<Ok>(s.serverUrl, 'POST', '/api/me/emote', to ? { kind, to } : { kind }, s.token),
  say: (s: Session, text: string) => request<Ok>(s.serverUrl, 'POST', '/api/me/say', { text: Array.from(text).slice(0, 80).join('') }, s.token),
  patchMe: (s: Session, patch: { name?: string; avatar?: Avatar }) => request<Ok>(s.serverUrl, 'PATCH', '/api/me', patch, s.token),
  leave: (s: Session) => request<Ok>(s.serverUrl, 'DELETE', '/api/me', undefined, s.token),
};

// ---------------------------------------------------------------- WebSocket

export type ConnState = 'connecting' | 'open' | 'closed' | 'paused';
export type RoomListener = {
  onRoom: (room: Room, serverNow: number | null) => void;
  onState?: (s: ConnState) => void;
  /** Server closed with 4401 (left/kicked) or 4404 (room gone): no reconnect. */
  onFatal?: (code: number) => void;
};

/**
 * Subscribe to live room updates. Auto-reconnects with exponential backoff
 * (1s → 30s, jittered), pauses while the app is in the background and
 * reconnects immediately when it comes back. Returns an unsubscribe fn.
 */
export function subscribeRoom(session: Session, listener: RoomListener): () => void {
  const wsUrl =
    normalizeServer(session.serverUrl).replace(/^http/i, 'ws') +
    `/ws?room=${encodeURIComponent(session.roomCode)}&token=${encodeURIComponent(session.token)}`;
  let ws: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let appState: string = AppState.currentState || "active";

  const setState = (s: ConnState) => listener.onState?.(s);
  const clearTimers = () => {
    if (retryTimer) clearTimeout(retryTimer);
    if (pingTimer) clearInterval(pingTimer);
    retryTimer = null;
    pingTimer = null;
  };
  const closeSocket = () => {
    clearTimers();
    if (ws) {
      const w = ws;
      ws = null;
      w.onopen = w.onclose = w.onerror = w.onmessage = null;
      try {
        w.close();
      } catch {}
    }
  };
  const scheduleRetry = () => {
    if (stopped || appState !== 'active') return;
    const base = Math.min(30000, 1000 * Math.pow(2, attempt));
    attempt++;
    retryTimer = setTimeout(connect, base * (0.7 + Math.random() * 0.6));
  };
  function connect() {
    if (stopped || appState !== 'active') return;
    closeSocket();
    setState('connecting');
    let sock: WebSocket;
    try {
      sock = new WebSocket(wsUrl);
    } catch {
      setState('closed');
      scheduleRetry();
      return;
    }
    ws = sock;
    sock.onopen = () => {
      attempt = 0;
      setState('open');
      pingTimer = setInterval(() => {
        try {
          sock.send(JSON.stringify({ type: 'ping' }));
        } catch {}
      }, 25000);
    };
    sock.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg && msg.type === 'room' && msg.room) listener.onRoom(msg.room, typeof msg.now === 'number' ? msg.now : null);
      } catch {}
    };
    sock.onerror = () => {};
    sock.onclose = (ev) => {
      if (ws !== sock) return;
      ws = null;
      clearTimers();
      setState('closed');
      if (ev && (ev.code === 4401 || ev.code === 4404)) {
        stopped = true;
        listener.onFatal?.(ev.code);
        return;
      }
      scheduleRetry();
    };
  }

  const sub = AppState.addEventListener('change', (next) => {
    const prev = appState;
    appState = next;
    if (next === 'active' && prev !== 'active') {
      attempt = 0;
      connect();
    } else if (next !== 'active' && prev === 'active') {
      closeSocket();
      setState('paused');
    }
  });

  if (appState === 'active') connect();
  else setState('paused');

  return () => {
    stopped = true;
    sub.remove();
    closeSocket();
  };
}
