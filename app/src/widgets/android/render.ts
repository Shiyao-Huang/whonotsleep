// RN-side widget rendering: session/room loading (AsyncStorage + fetch with
// timeout + offline cache) and building the JSX for each widget.
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SERVER } from '../../../../shared/protocol.js';
import type { WidgetInfo } from 'react-native-android-widget';
import { MeWidget } from './MeWidget';
import { RoomWidget, type WidgetViewProps } from './RoomWidget';
import {
  derive,
  imageAreaDp,
  meSaidGoodnight,
  meStatusText,
  renderDerivedImage,
  roomStatusText,
  type Derived,
  type RenderedImage,
  type Session,
  type WidgetName,
} from './pipeline';

export type { Session } from './pipeline';

export const SESSION_KEY = 'wns:session';
export const LAST_ROOM_KEY = 'wns:lastRoom';
const FETCH_TIMEOUT_MS = 8000;

// Room shape is defined in shared/protocol.js; widgets only pass it through.
export type Room = { code: string; name?: string; members: readonly unknown[] };

export async function loadSession(): Promise<Session | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Session>;
    if (!s || !s.roomCode || !s.token) return null;
    // Same fallback as the app's api.loadSession(): older sessions may lack serverUrl.
    return { ...s, serverUrl: s.serverUrl || DEFAULT_SERVER } as Session;
  } catch {
    return null;
  }
}

export async function loadCachedRoom(session?: Session | null): Promise<Room | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_ROOM_KEY);
    if (!raw) return null;
    const room = JSON.parse(raw) as Room;
    if (session && room?.code && room.code !== session.roomCode) return null;
    return room;
  } catch {
    return null;
  }
}

export async function clearCachedRoom(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LAST_ROOM_KEY);
  } catch {
    // ignore storage errors
  }
}

export async function saveCachedRoom(room: Room | null | undefined): Promise<void> {
  if (!room) return;
  try {
    await AsyncStorage.setItem(LAST_ROOM_KEY, JSON.stringify(room));
  } catch {
    // ignore storage errors
  }
}

function baseUrl(session: Session): string {
  return session.serverUrl.replace(/\/+$/, '');
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = FETCH_TIMEOUT_MS): Promise<Response> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl?.abort();
      reject(new Error('timeout'));
    }, ms);
  });
  try {
    return await Promise.race([fetch(url, { ...init, signal: ctrl?.signal }), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** GET /api/rooms/:code -> room (also refreshes the offline cache). */
export async function fetchRoom(session: Session): Promise<Room | null> {
  const res = await fetchWithTimeout(`${baseUrl(session)}/api/rooms/${encodeURIComponent(session.roomCode)}`, {
    headers: { Authorization: `Bearer ${session.token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { room?: Room };
  const room = json.room ?? null;
  await saveCachedRoom(room);
  return room;
}

/** Fresh room if reachable, else the cached one. */
export async function loadRoom(session: Session): Promise<{ room: Room | null; offline: boolean }> {
  try {
    const room = await fetchRoom(session);
    if (room) return { room, offline: false };
  } catch {
    // fall through to cache
  }
  return { room: await loadCachedRoom(session), offline: true };
}

/** POST /api/me/goodnight | /api/me/morning with bearer token. */
export async function postMe(session: Session, action: 'goodnight' | 'morning'): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${baseUrl(session)}/api/me/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------ JSX building

interface BuildArgs {
  widgetName: string;
  widthDp: number;
  heightDp: number;
  density: number;
  session: Session | null;
  room: Room | null;
  offline?: boolean;
  /** overrides the status text (e.g. a failed goodnight POST) */
  notice?: string | null;
  now?: number;
}

function asWidgetName(name: string): WidgetName {
  return name === 'MeWidget' ? 'MeWidget' : 'RoomWidget';
}

function safeImage(
  derived: Derived,
  widget: WidgetName,
  a: BuildArgs,
  focusId: string | null,
): RenderedImage | null {
  try {
    const area = imageAreaDp(widget, a.widthDp, a.heightDp);
    return renderDerivedImage(derived, {
      layout: widget === 'MeWidget' ? 'small' : 'wide',
      focusId,
      widthDp: area.width,
      heightDp: area.height,
      density: a.density,
      now: a.now,
    });
  } catch (e) {
    console.warn('[wns widget] render failed', e);
    return null;
  }
}

/** Build the JSX tree for one widget instance. Never throws. */
export function buildWidget(a: BuildArgs): React.JSX.Element {
  const widget = asWidgetName(a.widgetName);
  const View = widget === 'MeWidget' ? MeWidget : RoomWidget;
  const now = a.now ?? Date.now();

  if (!a.session) {
    // Cute empty pixel room + join hint.
    let image: RenderedImage | null = null;
    try {
      image = safeImage(derive({ code: '', name: '', members: [] }, now), widget, a, null);
    } catch {
      image = null;
    }
    const props: WidgetViewProps = {
      image,
      status: widget === 'MeWidget' ? '打开 App 加入' : '打开 App 加入房间 🌙',
      noSession: true,
      fallbackText: '🛏️ 打开 App 加入房间',
    };
    return React.createElement(View, props);
  }

  let derived: Derived;
  try {
    derived = derive(a.room ?? { code: a.session.roomCode, members: [] }, now);
  } catch (e) {
    console.warn('[wns widget] derive failed', e);
    return React.createElement(View, { image: null, status: '出错了，点我刷新', fallbackText: '(っ˘ω˘ς) zzz' });
  }

  const memberId = a.session.memberId;
  const image = safeImage(derived, widget, a, widget === 'MeWidget' ? memberId : null);
  let status = widget === 'MeWidget' ? meStatusText(derived, memberId) : roomStatusText(derived);
  if (!a.room) status = '连不上服务器…点我重试';
  else if (a.offline) status = `${status} · 离线`;
  if (a.notice) status = a.notice;

  return React.createElement(View, {
    image,
    status,
    alert: derived.owls.length > 0,
    saidGoodnight: meSaidGoodnight(derived, memberId),
    fallbackText: '🌙 zzz…',
  });
}

export function buildFromInfo(
  info: WidgetInfo,
  session: Session | null,
  room: Room | null,
  offline = false,
  notice: string | null = null,
): React.JSX.Element {
  return buildWidget({
    widgetName: info.widgetName,
    widthDp: info.width,
    heightDp: info.height,
    density: info.screenInfo?.density || 2.75,
    session,
    room,
    offline,
    notice,
  });
}
