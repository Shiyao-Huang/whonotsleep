import React, { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import PixelScene from '../components/PixelScene';
import { AvatarSwatch } from '../components/AvatarPicker';
import { ErrorLine, PButton, PText, Screen } from '../components/ui';
import { ConnState, Session, api, errText } from '../api';
import { DerivedMember, EMOTES, Room as RoomT, deriveScene } from '../shared';
import { EMOTE_EMOJI, EMOTE_NAME, clock, eventIcon, eventText, statusChip } from '../format';
import { C, MONO, haptic, toolColor } from '../theme';

type Props = {
  session: Session;
  room: RoomT | null;
  conn: ConnState;
  clockSkew: number;
  loadError: string | null;
  ai: { enabled: boolean; busy: boolean; lastError: string | null; speakNow: () => Promise<string | null>; clearError: () => void };
  onSynced: () => void;
  onLink: () => void;
  onSettings: () => void;
  onAssistant: () => void;
};

const CHIP_COLORS: Record<string, string> = {
  sit: C.amber,
  away: C.dim,
  sleep: C.violet,
  gone: C.faint,
};

export default function RoomScreen({ session, room, conn, clockSkew, loadError, ai, onSynced, onLink, onSettings, onAssistant }: Props) {
  const [tick, setTick] = useState(Date.now());
  const [selected, setSelected] = useState<string | null>(null);
  const [tray, setTray] = useState<'none' | 'emote' | 'say'>('none');
  const [sayText, setSayText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  const now = tick + clockSkew;
  const derived = useMemo(() => (room ? deriveScene(room, now) : null), [room, now]);
  const me = derived?.members.find((m) => m.id === session.memberId) || null;
  const selectedMember = derived?.members.find((m) => m.id === selected) || null;

  const run = async (key: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      haptic.ok();
      after?.();
    } catch (e) {
      haptic.err();
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const shareRoom = () => {
    haptic.tap();
    if (!room) return;
    Share.share({
      message: `来「${room.name}」一起熬夜吧 🌙\n打开 WhoNotSleep（谁还没睡）输入房间码：${room.code}`,
    }).catch(() => {});
  };

  const sendEmote = (kind: string) =>
    run('emote', () => api.emote(session, kind, selected && selected !== session.memberId ? selected : null), () => setTray('none'));

  const sendSay = () => {
    const text = sayText.trim();
    if (!text) return;
    run('say', () => api.say(session, text), () => {
      setSayText('');
      setTray('none');
    });
  };

  const goodnight = me?.saidGoodnight
    ? () => run('gn', () => api.morning(session), onSynced)
    : () => run('gn', () => api.goodnight(session), onSynced);

  const events = (room?.events || []).slice(-30).reverse();

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {/* header */}
        <View style={styles.header}>
          <Pressable onPress={shareRoom} style={{ flex: 1 }}>
            <PText bold size={18} numberOfLines={1}>
              {room?.name || '……'}
            </PText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <View style={[styles.dot, { backgroundColor: conn === 'open' ? C.mint : conn === 'connecting' ? C.amber : C.red }]} />
              <PText size={12} color={C.amber} bold style={{ letterSpacing: 3 }}>
                #{session.roomCode}
              </PText>
              <PText size={11} color={C.dim}>
                {conn === 'open' ? '点我分享' : conn === 'connecting' ? '连接中…' : '离线，重连中…'}
              </PText>
            </View>
          </Pressable>
          <PButton small title="🤖 AI" color={C.violet} textColor="#fff" onPress={onAssistant} />
          <PButton small title="💻" color={C.panel2} textColor={C.ink} onPress={onLink} />
          <PButton small title="⚙" color={C.panel2} textColor={C.ink} onPress={onSettings} />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
          <View style={styles.sceneFrame}>
            <PixelScene
              room={room}
              clockSkew={clockSkew}
              meId={session.memberId}
              selectedId={selected}
              onSelectMember={(id) => {
                haptic.tap();
                setSelected(id);
                if (id) setTray('emote');
              }}
            />
          </View>
          {derived && derived.owls.length > 0 && (
            <View style={styles.owlBanner}>
              <PText bold size={13} color="#14111f">
                ❗ {derived.members.filter((m) => m.nightOwl).map((m) => m.name).join('、')} 说了晚安却还在用 AI，被抓包！
              </PText>
            </View>
          )}

          <ErrorLine text={loadError && !room ? loadError : null} />

          {/* members */}
          <PText bold size={13} color={C.dim} style={styles.section}>
            谁还没睡？ {derived ? `${derived.members.filter((m) => m.pose === 'typing' || m.pose === 'sitting').length}/${derived.members.length}` : ''}
          </PText>
          {derived?.members.map((m) => (
            <MemberRow
              key={m.id}
              m={m}
              now={now}
              isMe={m.id === session.memberId}
              selected={m.id === selected}
              onPress={() => {
                haptic.tap();
                setSelected(m.id === selected ? null : m.id);
                setTray('emote');
              }}
            />
          ))}
          {derived && derived.members.length < 2 && (
            <PText size={12} color={C.dim} style={{ marginHorizontal: 16, marginTop: 4 }} onPress={shareRoom}>
              房间里只有你一个人…点这里把房间码 {session.roomCode} 发给朋友 📮
            </PText>
          )}

          {/* feed */}
          <PText bold size={13} color={C.dim} style={styles.section}>
            动态
          </PText>
          {events.length === 0 && (
            <PText size={12} color={C.faint} style={{ marginHorizontal: 16 }}>
              还没有动静…
            </PText>
          )}
          {room &&
            events.map((e, i) => (
              <View key={`${e.at}-${i}`} style={styles.event}>
                <PText size={11} color={C.faint} style={{ width: 44 }}>
                  {clock(e.at)}
                </PText>
                <PText size={12} style={{ width: 22 }}>
                  {eventIcon(e)}
                </PText>
                <PText size={12} color={C.ink} style={{ flex: 1 }}>
                  {eventText(e, room)}
                </PText>
              </View>
            ))}
        </ScrollView>

        {/* trays */}
        {(err || ai.lastError) && (
          <Pressable
            onPress={() => {
              setErr(null);
              ai.clearError();
            }}
            style={styles.errBar}
          >
            <PText size={12} color={C.red}>
              ⚠ {err || ai.lastError}（点击关闭）
            </PText>
          </Pressable>
        )}
        {tray === 'emote' && (
          <View style={styles.tray}>
            <PText size={12} color={C.dim} style={{ marginBottom: 6 }}>
              {selectedMember && selectedMember.id !== session.memberId ? `对 ${selectedMember.name} 发表情：` : '发个表情：'}
            </PText>
            <View style={styles.emoteGrid}>
              {EMOTES.map((k) => (
                <Pressable
                  key={k}
                  disabled={busy === 'emote'}
                  onPress={() => sendEmote(k)}
                  style={({ pressed }) => [styles.emote, pressed && { backgroundColor: C.border }]}
                >
                  <PText size={22}>{EMOTE_EMOJI[k] || '✨'}</PText>
                  <PText size={9} color={C.dim}>
                    {EMOTE_NAME[k] || k}
                  </PText>
                </Pressable>
              ))}
            </View>
          </View>
        )}
        {tray === 'say' && (
          <View style={[styles.tray, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
            <TextInput
              value={sayText}
              onChangeText={setSayText}
              placeholder="让小人说点什么…"
              placeholderTextColor={C.faint}
              maxLength={80}
              autoFocus
              returnKeyType="send"
              onSubmitEditing={sendSay}
              style={styles.sayInput}
            />
            <PButton small title="发送" color={C.mint} loading={busy === 'say'} onPress={sendSay} />
          </View>
        )}

        {/* action bar */}
        <View style={styles.bar}>
          <PButton
            small
            title={me?.saidGoodnight ? '☀️ 早安' : '🌙 晚安'}
            color={me?.saidGoodnight ? C.amber : C.violet}
            loading={busy === 'gn'}
            onPress={goodnight}
            style={{ flex: 1.3 }}
          />
          <PButton
            small
            title="😀"
            color={tray === 'emote' ? C.amber : C.panel2}
            textColor={tray === 'emote' ? '#14111f' : C.ink}
            onPress={() => setTray(tray === 'emote' ? 'none' : 'emote')}
          />
          <PButton
            small
            title="💬"
            color={tray === 'say' ? C.amber : C.panel2}
            textColor={tray === 'say' ? '#14111f' : C.ink}
            onPress={() => setTray(tray === 'say' ? 'none' : 'say')}
          />
          <PButton
            small
            title={ai.busy ? '想想…' : '🤖 让小人说句话'}
            color={C.mint}
            loading={ai.busy}
            onPress={() => ai.speakNow()}
            style={{ flex: 2 }}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function MemberRow({
  m,
  now,
  isMe,
  selected,
  onPress,
}: {
  m: DerivedMember;
  now: number;
  isMe: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const chip = statusChip(m, now);
  const chipColor = chip.kind === 'work' ? toolColor(m.tool) : CHIP_COLORS[chip.kind];
  return (
    <Pressable onPress={onPress} style={[styles.row, selected && { borderColor: C.amber }]}>
      <AvatarSwatch avatar={m.avatar} />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <PText bold size={14} numberOfLines={1} style={{ flexShrink: 1 }}>
            {m.name}
            {isMe ? <PText size={11} color={C.amber}>{' (我)'}</PText> : null}
          </PText>
          {m.badge === 'caught' && (
            <View style={[styles.badge, { backgroundColor: C.red }]}>
              <PText bold size={10} color="#fff">
                被抓包！
              </PText>
            </View>
          )}
          {m.badge === 'question' && <PText size={14}>❓</PText>}
          {m.hasComputer ? <PText size={11}>💻</PText> : null}
        </View>
        <View style={[styles.chip, { borderColor: chipColor }]}>
          {chip.kind === 'work' && <View style={[styles.chipDot, { backgroundColor: chipColor }]} />}
          <PText size={11} color={chipColor} numberOfLines={1}>
            {chip.text}
          </PText>
        </View>
        {m.activeSay ? (
          <PText size={12} color={C.ink} numberOfLines={2} style={{ marginTop: 4 }}>
            💬 {m.activeSay.text}
          </PText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  dot: { width: 8, height: 8, borderWidth: 1, borderColor: '#000' },
  sceneFrame: { borderTopWidth: 2, borderBottomWidth: 2, borderColor: '#000' },
  owlBanner: { backgroundColor: C.amber, paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 2, borderColor: '#000' },
  section: { marginHorizontal: 16, marginTop: 16, marginBottom: 8, letterSpacing: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 6,
    padding: 10,
    backgroundColor: C.panel,
    borderWidth: 2,
    borderColor: C.border,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
    gap: 4,
    maxWidth: '100%',
  },
  chipDot: { width: 6, height: 6 },
  badge: { paddingHorizontal: 4, paddingVertical: 1, borderWidth: 1, borderColor: '#000' },
  event: { flexDirection: 'row', alignItems: 'flex-start', marginHorizontal: 16, paddingVertical: 4, borderBottomWidth: 1, borderColor: C.panel2 },
  tray: { backgroundColor: C.panel, borderTopWidth: 2, borderColor: C.border, padding: 10 },
  emoteGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  emote: { width: '19%', alignItems: 'center', paddingVertical: 6, borderWidth: 2, borderColor: C.border, marginBottom: 4, backgroundColor: C.panel2 },
  sayInput: {
    flex: 1,
    fontFamily: MONO,
    fontSize: 15,
    color: C.ink,
    backgroundColor: C.panel2,
    borderWidth: 2,
    borderColor: C.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  errBar: { backgroundColor: '#2a0f18', paddingHorizontal: 12, paddingVertical: 6 },
  bar: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    borderTopWidth: 2,
    borderColor: '#000',
    backgroundColor: C.bg,
  },
});
