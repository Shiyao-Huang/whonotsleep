import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import AvatarPicker from '../components/AvatarPicker';
import { PButton, PInput, PText, Screen } from '../components/ui';
import { Profile } from '../api';
import { avatarFromSeed } from '../shared';
import { C, haptic } from '../theme';

export default function Onboarding({
  initial,
  onDone,
  onSettings,
}: {
  initial: Profile | null;
  onDone: (p: Profile) => void;
  onSettings: () => void;
}) {
  const seed = useMemo(() => String(Date.now()) + Math.random(), []);
  const [name, setName] = useState(initial?.name || '');
  const [avatar, setAvatar] = useState(initial?.avatar || avatarFromSeed(seed));
  const ok = name.trim().length > 0;
  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <PText bold size={28} color={C.amber} style={{ textAlign: 'center', marginTop: 12 }}>
            谁还没睡？
          </PText>
          <PText size={12} color={C.dim} style={{ textAlign: 'center', marginTop: 6, marginBottom: 20 }}>
            WHO NOT SLEEP · 深夜像素小屋
          </PText>
          <PText size={13} color={C.dim} style={{ marginBottom: 16, lineHeight: 20 }}>
            你一打开 AI 工具，你的像素小人就会坐到桌前敲键盘。说了晚安又偷偷爬起来？朋友们都会看到 ❗
          </PText>
          <PInput
            label="你的名字"
            value={name}
            onChangeText={(t) => setName(Array.from(t).slice(0, 24).join(''))}
            placeholder="比如：小明"
            maxLength={24}
            returnKeyType="done"
          />
          <PText size={12} color={C.dim} style={{ marginBottom: 8 }}>
            捏一个小人
          </PText>
          <AvatarPicker value={avatar} onChange={setAvatar} />
          <View style={{ height: 20 }} />
          <PButton
            title="下一步 ▶"
            disabled={!ok}
            onPress={() => {
              haptic.ok();
              onDone({ name: name.trim(), avatar });
            }}
          />
          <PText size={12} color={C.faint} style={{ textAlign: 'center', marginTop: 16 }} onPress={onSettings}>
            ⚙ 服务器设置
          </PText>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
