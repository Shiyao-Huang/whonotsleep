import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, Switch, View } from 'react-native';
import AvatarPicker, { AvatarPortrait } from '../components/AvatarPicker';
import { Card, ErrorLine, Header, PButton, PInput, PText, Screen } from '../components/ui';
import { ApiError, Profile, Session, api, errText, normalizeServer } from '../api';
import { OWN_KEY_DEFAULT_MODEL, describeAiBackend, loadAiKey, loadAiSettings, saveAiKey, saveAiSettings } from '../ai';
import { DEFAULT_SERVER } from '../shared';
import { C, haptic } from '../theme';

type Props = {
  session: Session | null;
  profile: Profile | null;
  serverUrl: string;
  onBack: () => void;
  onProfileChange: (p: Profile) => Promise<void>;
  onServerChange: (url: string) => Promise<void>;
  onLeft: () => Promise<void>;
  /** true right before DELETE /api/me so the app ignores the server's 4401/4404 close. */
  onLeaving?: (leaving: boolean) => void;
  onAiChanged: () => void;
  /** Open the AI assistant (only offered while in a room). */
  onAssistant?: () => void;
};

export default function Settings({ session, profile, serverUrl, onBack, onProfileChange, onServerChange, onLeft, onLeaving, onAiChanged, onAssistant }: Props) {
  // profile
  const [name, setName] = useState(profile?.name || '');
  const [avatar, setAvatar] = useState(profile?.avatar || { skin: 0, hair: 0, hairStyle: 0, shirt: 0, accessory: 0 });
  const [editAvatar, setEditAvatar] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  // server
  const [server, setServer] = useState(session?.serverUrl || serverUrl);
  const [serverMsg, setServerMsg] = useState<string | null>(null);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  // ai
  const [aiEnabled, setAiEnabled] = useState(false);
  const [model, setModel] = useState('');
  const [backend, setBackend] = useState<{ mode: 'server' | 'own'; model: string; available: boolean } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    loadAiSettings().then((s) => {
      setAiEnabled(s.enabled);
      setModel(s.model);
    });
    loadAiKey().then((k) => {
      setHasKey(!!k);
      if (k) setShowAdvanced(true);
    });
  }, []);

  const aiServer = session?.serverUrl || serverUrl;
  useEffect(() => {
    describeAiBackend(aiServer).then(setBackend).catch(() => setBackend(null));
  }, [aiServer, hasKey]);

  const saveProfile = async () => {
    const n = name.trim();
    if (!n) return setProfileErr('名字不能为空');
    setSavingProfile(true);
    setProfileErr(null);
    setProfileMsg(null);
    try {
      if (session) await api.patchMe(session, { name: n, avatar });
      await onProfileChange({ name: n, avatar });
      haptic.ok();
      setProfileMsg('已保存 ✓');
      setEditAvatar(false);
    } catch (e) {
      haptic.err();
      setProfileErr(errText(e));
    } finally {
      setSavingProfile(false);
    }
  };

  const testServer = async () => {
    setTesting(true);
    setServerErr(null);
    setServerMsg(null);
    const url = normalizeServer(server);
    try {
      await api.health(url);
      if (!session) await onServerChange(url);
      setServer(url);
      haptic.ok();
      setServerMsg(session ? '服务器在线 ✓' : '已保存，服务器在线 ✓');
    } catch (e) {
      haptic.err();
      setServerErr(errText(e));
    } finally {
      setTesting(false);
    }
  };

  const saveAi = async (patch: { enabled?: boolean; model?: string }) => {
    const next = { enabled: patch.enabled ?? aiEnabled, model: (patch.model ?? model).trim() };
    setAiEnabled(next.enabled);
    await saveAiSettings(next);
    onAiChanged();
  };

  const saveKey = async () => {
    try {
      await saveAiKey(keyInput);
      setHasKey(!!keyInput.trim());
      setKeyInput('');
      haptic.ok();
      setAiMsg(keyInput.trim() ? 'Key 已安全保存 🔒' : 'Key 已删除');
      onAiChanged();
    } catch (e: any) {
      setAiMsg('保存失败：' + (e?.message || e));
    }
  };

  const leave = () => {
    if (!session) return;
    Alert.alert('搬出房间？', '你的小人会从房间里消失，连接的电脑也会断开。', [
      { text: '再想想', style: 'cancel' },
      {
        text: '搬走',
        style: 'destructive',
        onPress: async () => {
          setLeaving(true);
          onLeaving?.(true);
          try {
            await api.leave(session);
          } catch (e) {
            // already gone / token invalid: leave locally anyway
            if (!(e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404))) {
              setLeaving(false);
              onLeaving?.(false);
              Alert.alert('出错了', errText(e));
              return;
            }
          }
          haptic.bump();
          await onLeft();
        },
      },
    ]);
  };

  return (
    <Screen>
      <Header title="设置 ⚙" onBack={onBack} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {profile && (
            <>
              <PText bold size={13} color={C.dim} style={{ marginBottom: 8, letterSpacing: 2 }}>
                我的小人
              </PText>
              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <AvatarPortrait avatar={avatar} size={56} />
                  <View style={{ flex: 1 }}>
                    <PInput value={name} onChangeText={(t) => setName(Array.from(t).slice(0, 24).join(''))} maxLength={24} placeholder="名字" />
                  </View>
                </View>
                {editAvatar ? (
                  <AvatarPicker value={avatar} onChange={setAvatar} />
                ) : (
                  <PText size={12} color={C.amber} onPress={() => setEditAvatar(true)} style={{ marginBottom: 8 }}>
                    ✎ 换造型
                  </PText>
                )}
                <ErrorLine text={profileErr} />
                {profileMsg ? (
                  <PText size={12} color={C.mint} style={{ marginBottom: 8 }}>
                    {profileMsg}
                  </PText>
                ) : null}
                <PButton small title="保存" loading={savingProfile} onPress={saveProfile} style={{ marginTop: 8 }} />
              </Card>
            </>
          )}

          <PText bold size={13} color={C.dim} style={{ marginBottom: 8, marginTop: 8, letterSpacing: 2 }}>
            AI 叽里呱啦 🤖
          </PText>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <PText bold>自动碎碎念</PText>
                <PText size={11} color={C.dim} style={{ marginTop: 2 }}>
                  App 打开时每 3–6 分钟让小人根据房间状况说一句
                </PText>
              </View>
              <Switch
                value={aiEnabled}
                onValueChange={(v) => {
                  haptic.tap();
                  saveAi({ enabled: v });
                }}
                trackColor={{ true: C.mint, false: C.faint }}
              />
            </View>
            <View style={{ marginBottom: 10 }}>
              <PText size={12} color={C.dim}>
                当前模型
              </PText>
              <PText bold size={14} color={backend?.available === false ? C.red : C.mint} style={{ marginTop: 2 }}>
                {backend
                  ? backend.mode === 'own'
                    ? `${backend.model}（你自己的 Key）`
                    : backend.available
                      ? `${backend.model}（服务器提供，免 Key）`
                      : '服务器 AI 暂不可用'
                  : '查询中…'}
              </PText>
            </View>
            {onAssistant && session ? (
              <PButton small title="🤖 打开 AI 小管家" color={C.violet} textColor="#fff" onPress={onAssistant} style={{ marginBottom: 12 }} />
            ) : null}
            <PText size={12} color={C.amber} onPress={() => setShowAdvanced(!showAdvanced)} style={{ marginBottom: showAdvanced ? 10 : 0 }}>
              {showAdvanced ? '▼' : '▶'} 高级：用我自己的 Anthropic Key
            </PText>
            {showAdvanced && (
              <>
                <PInput
                  label={hasKey ? 'Anthropic API Key（已保存 🔒，输入新的可替换）' : 'Anthropic API Key（可选）'}
                  value={keyInput}
                  onChangeText={setKeyInput}
                  placeholder={hasKey ? '••••••••••••' : 'sk-ant-...'}
                  secureTextEntry
                  autoCapitalize="none"
                />
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  <PButton small title="保存 Key" color={C.mint} disabled={!keyInput.trim()} onPress={saveKey} style={{ flex: 1 }} />
                  {hasKey && (
                    <PButton
                      small
                      title="删除"
                      color={C.panel2}
                      textColor={C.ink}
                      onPress={() => {
                        setKeyInput('');
                        saveAiKey('').then(() => {
                          setHasKey(false);
                          setAiMsg('Key 已删除，改回服务器 AI');
                          onAiChanged();
                        });
                      }}
                    />
                  )}
                </View>
                <PInput
                  label="模型（仅自带 Key 时生效）"
                  value={model}
                  onChangeText={setModel}
                  onEndEditing={() => saveAi({ model })}
                  autoCapitalize="none"
                  placeholder={OWN_KEY_DEFAULT_MODEL}
                />
                <PText size={11} color={C.faint}>
                  Key 只保存在本机安全存储里，直接请求 api.anthropic.com。不填就用服务器提供的 AI。
                </PText>
              </>
            )}
            {aiMsg ? (
              <PText size={12} color={C.mint} style={{ marginTop: 6 }}>
                {aiMsg}
              </PText>
            ) : null}
          </Card>

          <PText bold size={13} color={C.dim} style={{ marginBottom: 8, marginTop: 8, letterSpacing: 2 }}>
            服务器
          </PText>
          <Card>
            <PInput
              value={server}
              onChangeText={setServer}
              editable={!session}
              autoCapitalize="none"
              keyboardType="url"
              placeholder={DEFAULT_SERVER}
              style={session ? { opacity: 0.6 } : undefined}
            />
            {session ? (
              <PText size={11} color={C.faint} style={{ marginBottom: 8 }}>
                已在房间里，换服务器需要先搬出房间。
              </PText>
            ) : null}
            <ErrorLine text={serverErr} />
            {serverMsg ? (
              <PText size={12} color={C.mint} style={{ marginBottom: 8 }}>
                {serverMsg}
              </PText>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <PButton small title={session ? '测试连接' : '测试并保存'} loading={testing} onPress={testServer} style={{ flex: 1 }} />
              {!session && (
                <PButton small title="恢复默认" color={C.panel2} textColor={C.ink} onPress={() => setServer(DEFAULT_SERVER)} />
              )}
            </View>
          </Card>

          {session && (
            <>
              <PText bold size={13} color={C.dim} style={{ marginBottom: 8, marginTop: 8, letterSpacing: 2 }}>
                房间
              </PText>
              <Card>
                <PText size={12} color={C.dim} style={{ marginBottom: 10 }}>
                  房间码 #{session.roomCode}
                </PText>
                <PButton title="🚪 搬出房间" color={C.red} textColor="#fff" loading={leaving} onPress={leave} />
              </Card>
            </>
          )}
          <PText size={11} color={C.faint} style={{ textAlign: 'center', marginTop: 12 }}>
            WhoNotSleep · 谁还没睡 v1.0
          </PText>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
