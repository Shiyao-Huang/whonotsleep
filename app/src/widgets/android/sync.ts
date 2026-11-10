// Called by the app (src/widgets/index.ts -> syncWidgets) whenever the room
// changes while the app is running. Renders with the provided room (no refetch).
import { Platform } from 'react-native';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { WIDGET_NAMES } from './pipeline';
import { buildFromInfo, clearCachedRoom, loadCachedRoom, saveCachedRoom, type Room, type Session } from './render';

let pending: Promise<void> | null = null;
let queued: { session: Session | null; room: Room | null } | null = null;

async function run(session: Session | null, room: Room | null): Promise<void> {
  if (!session) {
    // Left the room: drop the cached snapshot so nothing stale lingers.
    await clearCachedRoom();
    room = null;
  } else if (room) {
    await saveCachedRoom(room);
  } else {
    // App had no room yet (e.g. still connecting): draw the last known one.
    room = await loadCachedRoom(session);
  }
  for (const widgetName of WIDGET_NAMES) {
    try {
      await requestWidgetUpdate({
        widgetName,
        renderWidget: (info) => buildFromInfo(info, session, room, false),
      });
    } catch (e) {
      console.warn('[wns widget] sync failed', widgetName, e);
    }
  }
}

/**
 * Save `room` as the offline cache and redraw both Android widgets with it.
 * Pass session=null after leaving the room to show the "join" state.
 * Calls are coalesced: while a sync runs, only the latest pending request is kept.
 */
export async function syncAndroidWidgets(session: Session | null, room: Room | null): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (pending) {
    queued = { session, room };
    return pending;
  }
  pending = (async () => {
    try {
      await run(session, room);
      while (queued) {
        const next = queued;
        queued = null;
        await run(next.session, next.room);
      }
    } finally {
      pending = null;
    }
  })();
  return pending;
}
