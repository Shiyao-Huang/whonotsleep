"use no memo";
// Headless task for the Android home-screen widgets (registered in app/index.ts).
import { requestWidgetUpdate, type WidgetTaskHandlerProps } from 'react-native-android-widget';
import { WIDGET_NAMES } from './pipeline';
import { buildFromInfo, buildWidget, loadCachedRoom, loadRoom, loadSession, postMe, type Room, type Session } from './render';

const nameToWidget: Record<string, true> = { RoomWidget: true, MeWidget: true };

/** Re-render every other placed widget (not the one being handled) with the same data. */
async function updateOthers(exceptName: string, session: Session | null, room: Room | null, offline: boolean) {
  await Promise.all(
    WIDGET_NAMES.filter((n) => n !== exceptName).map((widgetName) =>
      requestWidgetUpdate({
        widgetName,
        renderWidget: (info) => buildFromInfo(info, session, room, offline),
      }).catch(() => undefined),
    ),
  );
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const { widgetInfo, widgetAction, clickAction, renderWidget } = props;
  if (!nameToWidget[widgetInfo.widgetName]) return;

  try {
    switch (widgetAction) {
      case 'WIDGET_DELETED':
        return;

      case 'WIDGET_ADDED':
      case 'WIDGET_UPDATE':
      case 'WIDGET_RESIZED': {
        const session = await loadSession();
        if (!session) {
          renderWidget(buildFromInfo(widgetInfo, null, null));
          return;
        }
        if (widgetAction === 'WIDGET_RESIZED') {
          // Fast path: redraw at the new size from cache first.
          const cached = await loadCachedRoom(session);
          if (cached) renderWidget(buildFromInfo(widgetInfo, session, cached, false));
        }
        const { room, offline } = await loadRoom(session);
        renderWidget(buildFromInfo(widgetInfo, session, room, offline));
        return;
      }

      case 'WIDGET_CLICK': {
        const session = await loadSession();
        if (!session) {
          renderWidget(buildFromInfo(widgetInfo, null, null));
          return;
        }
        let notice: string | null = null;
        if (clickAction === 'GOODNIGHT' || clickAction === 'MORNING') {
          const ok = await postMe(session, clickAction === 'GOODNIGHT' ? 'goodnight' : 'morning');
          if (!ok) notice = clickAction === 'GOODNIGHT' ? '晚安没发出去…点我重试' : '早安没发出去…点我重试';
        }
        // GOODNIGHT / MORNING / REFRESH (and anything else): refetch and redraw.
        // (loadRoom -> fetchRoom already refreshes the offline cache.)
        const { room, offline } = await loadRoom(session);
        renderWidget(buildFromInfo(widgetInfo, session, room, offline, notice));
        await updateOthers(widgetInfo.widgetName, session, room, offline);
        return;
      }

      default:
        return;
    }
  } catch (e) {
    console.warn('[wns widget] task failed', e);
    try {
      renderWidget(
        buildWidget({
          widgetName: widgetInfo.widgetName,
          widthDp: widgetInfo.width,
          heightDp: widgetInfo.height,
          density: widgetInfo.screenInfo?.density || 2.75,
          session: await loadSession(),
          room: null,
        }),
      );
    } catch {
      // nothing more we can do
    }
  }
}
