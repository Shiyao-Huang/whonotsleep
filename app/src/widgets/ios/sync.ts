// JS side of the iOS home-screen widget (targets/widget, Swift WidgetKit).
// Writes the session into the shared App Group so the widget extension can
// fetch scene.png / room JSON itself, and asks WidgetKit to reload timelines.
import { Platform } from 'react-native';
import { ExtensionStorage } from '@bacons/apple-targets';
import { deriveScene, TOOLS } from '../../../../shared/protocol';

export const IOS_APP_GROUP = 'group.com.copizza.whonotsleep';
export const IOS_WIDGET_KIND = 'WhoNotSleepWidget';

/** Minimum gap between WidgetKit reloads when nothing visible changed (WidgetKit has a daily budget). */
const RELOAD_THROTTLE_MS = 60_000;

export type WidgetSession = {
  serverUrl: string;
  roomCode: string;
  token: string;
  memberId: string;
};

type AnyRoom = { code?: string; name?: string; members?: any[] } | null | undefined;

let storage: ExtensionStorage | null = null;
let lastWritten: Record<string, string> = {};
let lastReloadAt = 0;
let lastVisibleKey = '';
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

function getStorage(): ExtensionStorage {
  if (!storage) storage = new ExtensionStorage(IOS_APP_GROUP);
  return storage;
}

/** Writes a key to the App Group if it changed; returns true when something was written. */
function writeKey(key: string, value: string): boolean {
  if (lastWritten[key] === value) return false;
  if (value) getStorage().set(key, value);
  else getStorage().remove(key);
  lastWritten[key] = value;
  return true;
}

/** Short human summary for the widget, e.g. "🦉 小明 还没睡！ · 2/3 在线" or "我: Claude Code · 敲代码中". */
export function buildSummary(session: WidgetSession, room: AnyRoom, now = Date.now(), derived?: any): string {
  if (!room) return '';
  const d = derived ?? deriveScene(room as any, now);
  const members: any[] = d.members;
  const online = members.filter((m) => m.online).length;
  const owls = members.filter((m) => m.nightOwl).map((m) => String(m.name || '?'));
  const me = members.find((m) => m.id === session.memberId);
  const parts: string[] = [];
  if (owls.length) parts.push(`🦉 ${owls.slice(0, 2).join('、')}${owls.length > 2 ? '等' : ''} 还没睡！`);
  parts.push(`${online}/${members.length} 在线`);
  if (me) {
    if (me.pose === 'typing') {
      const tool = (TOOLS as Record<string, { label: string }>)[me.tool || 'other'] || TOOLS.other;
      parts.push(`我在用 ${tool.label}`);
    } else if (me.pose === 'sleeping') {
      parts.push('我: 💤');
    }
  }
  return parts.join(' · ').slice(0, 80);
}

/** Signature of what the widget image shows (poses, badges, tools); changes force an immediate reload. */
function visibleKey(d: any): string {
  if (!d) return 'none';
  return (d.members as any[])
    .map((m) => [m.id, m.seat, m.pose, m.badge || '', m.tool || '', m.name, JSON.stringify(m.avatar || {})].join(':'))
    .join('|') + `#${d.lightsOn ? 1 : 0}`;
}

function reloadNow() {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  lastReloadAt = Date.now();
  try {
    ExtensionStorage.reloadWidget(IOS_WIDGET_KIND);
  } catch {
    // native module missing (Expo Go / web) — ignore
  }
}

/**
 * Push session + room info to the iOS widget. Safe to call on every room update:
 * App Group writes are de-duplicated and WidgetKit reloads are throttled to once per
 * 60 s unless the room's visible state (poses/badges/tools) changed.
 * Pass `session = null` (e.g. after leaving the room) to clear the widget.
 */
export async function syncIOSWidgets(session: WidgetSession | null, room: AnyRoom): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const now = Date.now();
  let dirty = false;
  let derived: any = null;
  try {
    // A room for a different code than the session (stale state during a room switch)
    // is treated as "not loaded yet".
    const roomOk = !!session && !!room && (!room.code || room.code === session.roomCode);
    derived = roomOk ? deriveScene(room as any, now) : null;
    const values: [string, string][] = [
      ['serverUrl', session?.serverUrl ?? ''],
      ['roomCode', session?.roomCode ?? ''],
      ['memberId', session?.memberId ?? ''],
      ['token', session?.token ?? ''],
    ];
    if (roomOk) {
      values.push(['roomName', String(room?.name ?? '')], ['summary', buildSummary(session!, room, now, derived)]);
    } else if (!session || lastWritten.roomCode !== session.roomCode) {
      // Signed out, or switched rooms and the new room hasn't loaded: drop the old room's text.
      // (Same room still loading: keep the last name/summary instead of blanking them.)
      values.push(['roomName', ''], ['summary', '']);
    }
    for (const [k, v] of values) dirty = writeKey(k, v) || dirty;
  } catch (e) {
    console.warn('[ios-widget] ExtensionStorage write failed', e);
    return;
  }

  const prefix = session ? `${session.roomCode}/${session.memberId}/` : '';
  let key: string;
  if (!session) key = 'signed-out';
  else if (derived) key = prefix + visibleKey(derived);
  else if (lastVisibleKey.startsWith(prefix)) key = lastVisibleKey; // same room still loading: unchanged
  else key = prefix + 'none';
  const changed = key !== lastVisibleKey;
  lastVisibleKey = key;

  if (changed) {
    reloadNow();
    return;
  }
  if (!dirty) return; // nothing the widget reads has changed
  const since = now - lastReloadAt;
  if (since >= RELOAD_THROTTLE_MS) {
    reloadNow();
  } else if (!pendingTimer) {
    // Trailing reload so non-visual changes (status line counts) still land within ~60 s.
    pendingTimer = setTimeout(reloadNow, RELOAD_THROTTLE_MS - since);
  }
}
