import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  ApiError,
  Profile,
  Session,
  api,
  clearSession,
  errText,
  loadProfile,
  loadServerUrl,
  loadSession,
  saveProfile,
  saveServerUrl,
  saveSession,
} from './src/api';
import { useRoom } from './src/hooks/useRoom';
import { useAiChatter } from './src/hooks/useAiChatter';
import Onboarding from './src/screens/Onboarding';
import RoomGate from './src/screens/RoomGate';
import RoomScreen from './src/screens/Room';
import LinkComputer from './src/screens/LinkComputer';
import Settings from './src/screens/Settings';
import Assistant from './src/screens/Assistant';
import { AgentContext } from './src/agent/types';
import { loadAiSettings, saveAiSettings } from './src/ai';
import { C } from './src/theme';
import { syncWidgets } from './src/widgets';

type ScreenName = 'loading' | 'onboarding' | 'gate' | 'room' | 'link' | 'settings' | 'assistant';

export default function App() {
  const [screen, setScreen] = useState<ScreenName>('loading');
  const [settingsFrom, setSettingsFrom] = useState<ScreenName>('room');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [serverUrl, setServerUrl] = useState('');
  const [aiVersion, setAiVersion] = useState(0);
  const [assistantFrom, setAssistantFrom] = useState<ScreenName>('room');

  useEffect(() => {
    (async () => {
      const [p, s, url] = await Promise.all([loadProfile(), loadSession(), loadServerUrl()]);
      setProfile(p);
      setSession(s);
      setServerUrl(url);
      setScreen(s ? 'room' : p ? 'gate' : 'onboarding');
    })();
  }, []);

  // Set while the user is voluntarily leaving: the server then closes our socket
  // with 4401 (or 4404 if we were the last member), which must not show an alert.
  const leavingRef = useRef(false);

  const onFatal = useCallback(async (code: number) => {
    if (leavingRef.current) return;
    await clearSession();
    setSession(null);
    setScreen('gate');
    syncWidgets(null, null);
    Alert.alert(code === 4404 ? '房间没了 🏚' : '你已经不在这个房间了', '可以新建一个房间，或者用房间码重新加入。');
  }, []);

  const { room, conn, error, clockSkew, roomRef, syncWidgetsNow } = useRoom(session, onFatal);
  const ai = useAiChatter(session, roomRef, aiVersion);

  const openSettings = (from: ScreenName) => {
    setSettingsFrom(from);
    setScreen('settings');
  };
  const openAssistant = (from: ScreenName) => {
    setAssistantFrom(from);
    setScreen('assistant');
  };

  // Latest values for the AI agent (tools read these mid-run, so refs not closures).
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const connRef = useRef(conn);
  connRef.current = conn;
  const skewRef = useRef(clockSkew);
  skewRef.current = clockSkew;
  const assistantFromRef = useRef(assistantFrom);
  assistantFromRef.current = assistantFrom;

  const afterLeft = useCallback(async () => {
    sessionRef.current = null;
    await clearSession();
    setSession(null);
    setScreen('gate');
    syncWidgets(null, null);
  }, []);

  const agentCtx = useMemo<AgentContext>(
    () => ({
      getSession: () => sessionRef.current,
      getProfile: () => profileRef.current,
      setProfile: async (p) => {
        profileRef.current = p;
        await saveProfile(p);
        setProfile(p);
      },
      getRoom: () => roomRef.current,
      getClockSkew: () => skewRef.current,
      getConn: () => connRef.current,
      getFromScreen: () => assistantFromRef.current,
      navigate: (to) => {
        if (to === 'settings') setSettingsFrom('room');
        setScreen(to);
      },
      getAiChatterEnabled: async () => (await loadAiSettings()).enabled,
      setAiChatterEnabled: async (enabled) => {
        const cur = await loadAiSettings();
        await saveAiSettings({ ...cur, enabled });
        setAiVersion((v) => v + 1);
      },
      confirm: (title, message, confirmText) =>
        new Promise<boolean>((resolve) => {
          Alert.alert(
            title,
            message,
            [
              { text: '再想想', style: 'cancel', onPress: () => resolve(false) },
              { text: confirmText, style: 'destructive', onPress: () => resolve(true) },
            ],
            { cancelable: true, onDismiss: () => resolve(false) },
          );
        }),
      leaveRoom: async () => {
        const s = sessionRef.current;
        if (!s) return;
        leavingRef.current = true;
        try {
          await api.leave(s);
        } catch (e) {
          if (!(e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404))) {
            leavingRef.current = false;
            throw e;
          }
        }
        await afterLeft();
      },
    }),
    [roomRef, afterLeft],
  );

  // Android hardware back
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'link') return setScreen('room'), true;
      if (screen === 'settings') return setScreen(settingsFrom), true;
      if (screen === 'assistant') return setScreen(assistantFrom === 'settings' || session ? assistantFrom : 'gate'), true;
      if (screen === 'onboarding' && profile) return setScreen(session ? 'room' : 'gate'), true;
      return false;
    });
    return () => sub.remove();
  }, [screen, settingsFrom, assistantFrom, profile, session]);

  let body: React.ReactNode = null;
  if (screen === 'loading') {
    body = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.amber} />
      </View>
    );
  } else if (screen === 'settings') {
    body = (
      <Settings
        session={session}
        profile={profile}
        serverUrl={serverUrl}
        onBack={() => setScreen(settingsFrom === 'room' && !session ? 'gate' : settingsFrom)}
        onProfileChange={async (p) => {
          await saveProfile(p);
          setProfile(p);
        }}
        onServerChange={async (url) => {
          await saveServerUrl(url);
          setServerUrl(url);
        }}
        onLeaving={(v) => {
          leavingRef.current = v;
        }}
        onLeft={afterLeft}
        onAiChanged={() => setAiVersion((v) => v + 1)}
        onAssistant={() => openAssistant('settings')}
      />
    );
  } else if (screen === 'onboarding' || !profile) {
    body = (
      <Onboarding
        initial={profile}
        onSettings={() => openSettings('onboarding')}
        onDone={async (p) => {
          // In a room (e.g. the AI butler navigated here): sync to the server like Settings does.
          if (session) {
            try {
              await api.patchMe(session, { name: p.name, avatar: p.avatar });
            } catch (e) {
              Alert.alert('没能同步到房间', errText(e));
              return;
            }
          }
          await saveProfile(p);
          setProfile(p);
          setScreen(session ? 'room' : 'gate');
        }}
      />
    );
  } else if (!session) {
    body = (
      <RoomGate
        profile={profile}
        serverUrl={serverUrl}
        onEditProfile={() => setScreen('onboarding')}
        onSettings={() => openSettings('gate')}
        onJoined={async (s) => {
          leavingRef.current = false;
          await saveSession(s);
          setSession(s);
          setScreen('room');
        }}
      />
    );
  } else if (screen === 'link') {
    body = <LinkComputer session={session} onBack={() => setScreen('room')} />;
  } else if (screen === 'assistant') {
    body = (
      <Assistant
        session={session}
        profile={profile}
        ctx={agentCtx}
        onBack={() => setScreen(assistantFrom === 'settings' ? 'settings' : 'room')}
      />
    );
  } else {
    body = (
      <RoomScreen
        session={session}
        room={room}
        conn={conn}
        clockSkew={clockSkew}
        loadError={error?.message || null}
        ai={ai}
        onSynced={syncWidgetsNow}
        onLink={() => setScreen('link')}
        onSettings={() => openSettings('room')}
        onAssistant={() => openAssistant('room')}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="light" />
      {body}
    </View>
  );
}
