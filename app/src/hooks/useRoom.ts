import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { ConnState, Session, api, subscribeRoom } from '../api';
import { Room } from '../shared';
import { createWidgetSyncer } from '../widgets';

/**
 * Live room state for the current session: initial REST fetch, then WebSocket
 * pushes. Also keeps widgets in sync (throttled 15s) and, for phone-only
 * members (no linked computer), pings /api/me/report so they show as awake
 * while the app is open.
 */
export function useRoom(session: Session | null, onFatal?: (code: number) => void) {
  const [room, setRoom] = useState<Room | null>(null);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);
  const [clockSkew, setClockSkew] = useState(0);
  const roomRef = useRef<Room | null>(null);
  const syncer = useRef(createWidgetSyncer(15000)).current;
  const fatalRef = useRef(onFatal);
  fatalRef.current = onFatal;
  // Report a fatal condition at most once per session (REST check and WS close can both see it).
  const fatalFor = useRef<string | null>(null);
  const fireFatal = useCallback(
    (code: number) => {
      if (!session || fatalFor.current === session.token) return;
      fatalFor.current = session.token;
      fatalRef.current?.(code);
    },
    [session],
  );

  const apply = useCallback(
    (r: Room, serverNow: number | null) => {
      roomRef.current = r;
      setRoom(r);
      setError(null);
      if (serverNow) setClockSkew(serverNow - Date.now());
      if (session) syncer.push(session, r);
    },
    [session, syncer],
  );

  // REST fetch + validation. The server rejects a WS upgrade for a deleted room or
  // a removed member with a plain HTTP 404/401 (the client only sees close 1006),
  // so this is also run whenever the socket drops, to detect those cases.
  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const r = await api.getRoom(session.serverUrl, session.roomCode);
      if (!r.members.some((m) => m.id === session.memberId)) {
        fireFatal(4401);
        return;
      }
      apply(r, null);
    } catch (e: any) {
      setError({ status: e?.status, message: e?.message || String(e) });
      if (e?.status === 404) fireFatal(4404);
    }
  }, [session, apply, fireFatal]);

  useEffect(() => {
    roomRef.current = null;
    setRoom(null);
    setError(null);
    if (!session) return;
    refresh();
    let lastCheck = Date.now();
    const unsub = subscribeRoom(session, {
      onRoom: apply,
      onState: (s) => {
        setConn(s);
        if (s === 'closed' && Date.now() - lastCheck > 10000) {
          lastCheck = Date.now();
          refresh();
        }
      },
      onFatal: fireFatal,
    });
    return () => {
      unsub();
      syncer.cancel();
    };
  }, [session, apply, refresh, syncer, fireFatal]);

  // phone-only presence ping
  useEffect(() => {
    if (!session) return;
    const ping = () => {
      const me = roomRef.current?.members.find((m) => m.id === session.memberId);
      if (!me || me.hasComputer || AppState.currentState !== 'active') return;
      api.report(session, 'idle').catch(() => {});
    };
    const first = setTimeout(ping, 1500);
    const id = setInterval(ping, 30000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && ping());
    return () => {
      clearTimeout(first);
      clearInterval(id);
      sub.remove();
    };
  }, [session]);

  const syncWidgetsNow = useCallback(() => {
    if (session) syncer.flush(session, roomRef.current);
  }, [session, syncer]);

  return { room, conn, error, clockSkew, refresh, roomRef, syncWidgetsNow };
}
