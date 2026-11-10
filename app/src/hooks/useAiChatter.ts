import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { Session, api, errText } from '../api';
import { generateLine, loadAiSettings, nextChatterDelay } from '../ai';
import { Room } from '../shared';

/**
 * AI chatter: when enabled, every ~3–6 minutes while the app is foregrounded
 * ask the AI (server proxy by default) for a short in-character line and post it via /api/me/say.
 * `speakNow()` does the same on demand ("让小人说句话").
 */
export function useAiChatter(session: Session | null, roomRef: React.RefObject<Room | null>, settingsVersion = 0) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastLine, setLastLine] = useState<string | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    loadAiSettings().then((s) => setEnabled(s.enabled));
  }, [settingsVersion]);

  const speakNow = useCallback(async (): Promise<string | null> => {
    if (!session || busyRef.current) return null;
    const room = roomRef.current;
    if (!room) return null;
    busyRef.current = true;
    setBusy(true);
    setLastError(null);
    try {
      // Default: server-side AI proxy (no key on the phone). Own key is an optional override inside callMessages.
      const line = await generateLine({ session, room, meId: session.memberId });
      await api.say(session, line).catch((e) => {
        throw new Error(errText(e));
      });
      setLastLine(line);
      return line;
    } catch (e: any) {
      setLastError(e?.message || String(e));
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [session, roomRef]);

  useEffect(() => {
    if (!enabled || !session) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      timer = setTimeout(async () => {
        if (AppState.currentState === 'active') await speakNow();
        schedule();
      }, nextChatterDelay());
    };
    schedule();
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' && timer) {
        clearTimeout(timer);
        timer = null;
      } else if (s === 'active' && !timer) schedule();
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [enabled, session, speakNow]);

  return { enabled, busy, lastError, lastLine, speakNow, clearError: () => setLastError(null) };
}
