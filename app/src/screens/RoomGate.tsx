import React, { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { AvatarPortrait } from '../components/AvatarPicker';
import { Card, ErrorLine, PButton, PInput, PText, Screen } from '../components/ui';
import { Profile, Session, api, errText } from '../api';
import { C, haptic } from '../theme';

const CODE_RE = /[^A-Z2-9]/g;

export default function RoomGate({
  profile,
  serverUrl,
  onJoined,
  onEditProfile,
  onSettings,
}: {
  profile: Profile;
  serverUrl: string;
  onJoined: (s: Session) => void;
  onEditProfile: () => void;
  onSettings: () => void;
}) {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [roomName, setRoomName] = useState(`${profile.name} 的小屋`);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r =
        mode === 'create'
          ? await api.createRoom(serverUrl, roomName.trim() || `${profile.name} 的小屋`, profile)
          : await api.joinRoom(serverUrl, code, profile);
      haptic.ok();
      onJoined({ serverUrl, roomCode: r.room.code, token: r.token, memberId: r.memberId });
    } catch (e) {
      haptic.err();
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 12 }}>
            <AvatarPortrait avatar={profile.avatar} size={64} />
            <View style={{ flex: 1 }}>
              <PText bold size={20}>
                嗨，{profile.name}
              </PText>
              <PText size={12} color={C.amber} onPress={onEditProfile} style={{ marginTop: 4 }}>
                ✎ 改名字 / 换造型
              </PText>
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            <PButton
              small
              title="🏠 新建房间"
              color={mode === 'create' ? C.amber : C.panel2}
              textColor={mode === 'create' ? '#14111f' : C.ink}
              onPress={() => setMode('create')}
              style={{ flex: 1 }}
            />
            <PButton
              small
              title="🔑 加入房间"
              color={mode === 'join' ? C.mint : C.panel2}
              textColor={mode === 'join' ? '#14111f' : C.ink}
              onPress={() => setMode('join')}
              style={{ flex: 1 }}
            />
          </View>

          <Card>
            {mode === 'create' ? (
              <>
                <PInput label="房间名字" value={roomName} onChangeText={setRoomName} maxLength={32} />
                <PText size={12} color={C.dim} style={{ marginBottom: 12 }}>
                  建好后把 5 位房间码发给朋友，最多 6 个人。
                </PText>
              </>
            ) : (
              <>
                <PInput
                  label="房间码（5 位）"
                  value={code}
                  onChangeText={(t) => setCode(t.toUpperCase().replace(CODE_RE, '').slice(0, 5))}
                  autoCapitalize="characters"
                  placeholder="ABC23"
                  style={{ fontSize: 26, letterSpacing: 8, textAlign: 'center' }}
                />
              </>
            )}
            <ErrorLine text={err} />
            <PButton
              title={mode === 'create' ? '开房间 ✨' : '进去看看 ▶'}
              color={mode === 'create' ? C.amber : C.mint}
              loading={busy}
              disabled={mode === 'join' && code.length !== 5}
              onPress={go}
            />
          </Card>

          <PText size={11} color={C.faint} style={{ textAlign: 'center', marginTop: 8 }} onPress={onSettings}>
            服务器：{serverUrl.replace(/^https?:\/\//, '')} · ⚙ 设置
          </PText>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
