// Dispatches room updates to the platform home-screen widget modules.
// The platform modules are owned by the widget agents; a missing or failing
// module must never break the app, so everything is wrapped in try/catch.
import { Platform } from 'react-native';
import type { Session } from '../api';
import type { Room } from '../shared';

let warned = false;

export async function syncWidgets(session: Session | null, room: Room | null): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      const mod: any = await import('./android/sync');
      await mod?.syncAndroidWidgets?.(session, room);
    } else if (Platform.OS === 'ios') {
      const mod: any = await import('./ios/sync');
      await mod?.syncIOSWidgets?.(session, room);
    }
  } catch (e) {
    if (!warned) {
      warned = true;
      console.warn('[wns] widget sync failed', e);
    }
  }
}

/** Throttled syncer: at most once per `intervalMs`, trailing call keeps the latest room. */
export function createWidgetSyncer(intervalMs = 15000) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { session: Session; room: Room | null } | null = null;
  const run = () => {
    timer = null;
    if (!pending) return;
    const p = pending;
    pending = null;
    last = Date.now();
    syncWidgets(p.session, p.room);
  };
  return {
    push(session: Session, room: Room | null) {
      pending = { session, room };
      const wait = last + intervalMs - Date.now();
      if (wait <= 0) run();
      else if (!timer) timer = setTimeout(run, wait);
    },
    /** Sync now (goodnight / morning), bypassing the throttle. */
    flush(session: Session, room: Room | null) {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = { session, room };
      run();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
