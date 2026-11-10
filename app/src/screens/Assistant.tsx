// AI 小管家: chat with an LLM agent that can operate the whole app through tools.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Pressable, ScrollView, type ScrollViewInstance, type ViewInstance, Share, StyleSheet, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AvatarPortrait } from '../components/AvatarPicker';
import { Header, PButton, PText, Screen } from '../components/ui';
import { Profile, Session } from '../api';
import { AiMessage, describeAiBackend } from '../ai';
import { Avatar } from '../shared';
import { C, MONO, haptic } from '../theme';
import { AgentContext, RunState } from '../agent/types';
import { buildGuide, buildLiveContext, buildSystem } from '../agent/guide';
import { AgentEvent, runAgent } from '../agent/runAgent';
import { describeAvatarLine } from '../agent/catalog';

type Chip = { id: string; label: string; state: 'run' | 'ok' | 'err' | 'ask' };
type ChatMsg =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; text: string }
  | { id: string; role: 'tools'; chips: Chip[] }
  | { id: string; role: 'avatar'; avatar: Avatar }
  | { id: string; role: 'error'; text: string };

const STORE_KEY = 'wns:assistant';
const KEEP = 30;
const SUGGESTIONS = ['给我换个猫耳朵', '谁还没睡？', '帮我说晚安', '生成电脑配对码', '让我的小人说句俏皮话'];

let seq = 0;
const uid = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** user/assistant text turns for the model: alternating, starting with user. */
function toHistory(msgs: ChatMsg[]): AiMessage[] {
  const out: AiMessage[] = [];
  for (const m of msgs.slice(-14)) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.content = `${prev.content}\n${m.text}`;
    else out.push({ role: m.role, content: m.text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

export default function Assistant({
  session,
  profile,
  ctx,
  onBack,
}: {
  session: Session;
  profile: Profile | null;
  ctx: AgentContext;
  onBack: () => void;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState<{ label: string; ok: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const msgsRef = useRef<ChatMsg[]>([]);
  msgsRef.current = msgs;
  const guide = useMemo(() => buildGuide(), []);
  const modelLabelRef = useRef('');
  const aliveRef = useRef(true);
  // KeyboardAvoidingView compares its parent-relative frame with the keyboard's window
  // position; wrap it so its frame starts at 0 and pass the wrapper's window y as offset
  // (otherwise iOS's SafeAreaView top inset leaves the input partly under the keyboard).
  const kavRef = useRef<ViewInstance>(null);
  const [kbOffset, setKbOffset] = useState(0);
  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    const sub = Keyboard.addListener('keyboardDidShow', scrollToEnd);
    return () => {
      aliveRef.current = false;
      sub.remove();
    };
  }, [scrollToEnd]);

  // load persisted chat + model label
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORE_KEY)
      .then((s) => {
        if (!alive) return;
        const v: ChatMsg[] = s ? JSON.parse(s) : [];
        if (Array.isArray(v))
          setMsgs(
            v.map((m) => (m.role === 'tools' ? { ...m, chips: m.chips.map((c) => (c.state === 'run' ? { ...c, state: 'err' as const } : c)) } : m)),
          );
      })
      .catch(() => {})
      .finally(() => alive && setLoaded(true));
    describeAiBackend(session.serverUrl).then((b) => {
      if (!alive) return;
      modelLabelRef.current = b.model;
      setModel({ label: b.mode === 'own' ? `${b.model} · 自带Key` : b.available ? b.model : 'AI 暂不可用', ok: b.available });
    });
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [session.serverUrl]);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(msgs.slice(-KEEP))).catch(() => {});
  }, [msgs, loaded]);

  const push = useCallback((m: ChatMsg) => setMsgs((xs) => [...xs, m]), []);

  const send = useCallback(
    async (raw?: string) => {
      const text = (raw ?? input).trim();
      if (!text || busy) return;
      haptic.tap();
      setInput('');
      const before = msgsRef.current;
      const history = toHistory(before);
      const prevAssistant = [...before].reverse().find((m) => m.role === 'assistant') as { text: string } | undefined;
      push({ id: uid(), role: 'user', text });
      const run: RunState = { userText: text, prevAssistantText: prevAssistant?.text || '', pendingNav: null, avatar: null, share: null };
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setBusy(true);
      let toolsMsgId: string | null = null;
      const onEvent = (e: AgentEvent) => {
        if (ctrl.signal.aborted) return;
        if (e.type === 'text') {
          toolsMsgId = null;
          push({ id: uid(), role: 'assistant', text: e.truncated ? e.text + '…' : e.text });
        } else if (e.type === 'error') {
          toolsMsgId = null;
          haptic.err();
          push({ id: uid(), role: 'error', text: e.text });
        } else if (e.type === 'tool_start') {
          const chip: Chip = { id: e.id, label: e.label, state: 'run' };
          if (toolsMsgId) {
            const tid = toolsMsgId;
            setMsgs((xs) => xs.map((m) => (m.id === tid && m.role === 'tools' ? { ...m, chips: [...m.chips, chip] } : m)));
          } else {
            toolsMsgId = uid();
            push({ id: toolsMsgId, role: 'tools', chips: [chip] });
          }
        } else if (e.type === 'tool_end') {
          const state: Chip['state'] = e.ok ? 'ok' : e.result.needsConfirmation ? 'ask' : 'err';
          setMsgs((xs) =>
            xs.map((m) => (m.role === 'tools' ? { ...m, chips: m.chips.map((c) => (c.id === e.id ? { ...c, state } : c)) } : m)),
          );
          if (e.ok && e.name === 'update_avatar' && run.avatar) {
            haptic.ok();
            toolsMsgId = null;
            push({ id: uid(), role: 'avatar', avatar: run.avatar });
          }
        }
      };
      try {
        await runAgent({
          session,
          ctx,
          history,
          userText: text,
          run,
          signal: ctrl.signal,
          onEvent,
          system: async () => buildSystem(guide, await buildLiveContext(ctx, modelLabelRef.current)),
        });
      } catch (e: any) {
        push({ id: uid(), role: 'error', text: e?.message || String(e) });
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        setBusy(false);
      }
      if (ctrl.signal.aborted || !aliveRef.current) return;
      if (run.share) Share.share({ message: run.share }).catch(() => {});
      if (run.pendingNav) {
        const to = run.pendingNav;
        setTimeout(() => {
          if (aliveRef.current) ctx.navigate(to);
        }, 800);
      }
    },
    [input, busy, push, session, ctx, guide],
  );

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    push({ id: uid(), role: 'assistant', text: '好的，停下啦 ✋' });
  };

  const clear = () => {
    if (busy) return;
    haptic.bump();
    setMsgs([]);
  };

  return (
    <Screen>
      <Header
        title="🤖 AI 小管家"
        onBack={onBack}
        right={
          msgs.length ? (
            <PText size={12} color={C.dim} onPress={clear}>
              清空
            </PText>
          ) : null
        }
      />
      <View style={styles.modelBar}>
        <View style={[styles.dot, { backgroundColor: model ? (model.ok ? C.mint : C.red) : C.amber }]} />
        <PText size={11} color={C.dim} numberOfLines={1} style={{ flex: 1 }}>
          {model ? model.label : '连接 AI…'} · 我能直接帮你操作 App
        </PText>
      </View>
      <View
        ref={kavRef}
        style={{ flex: 1 }}
        onLayout={() => {
          // KAV sits at y=0 inside this wrapper, so the wrapper's window y is the offset it needs.
          kavRef.current?.measureInWindow((_x, wy) => {
            if (Number.isFinite(wy)) setKbOffset(Math.max(0, Math.round(wy)));
          });
        }}
      >
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={kbOffset}>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 12, paddingBottom: 16 }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={scrollToEnd}
          onLayout={scrollToEnd}
        >
          {loaded && msgs.length === 0 && (
            <View style={[styles.bubble, styles.botBubble]}>
              <PText size={14} style={{ lineHeight: 21 }}>
                嗨{profile ? `，${profile.name}` : ''}！我是像素小屋的管家 🤖{'\n'}
                想换造型、看看谁还没睡、说晚安、发表情、生成电脑配对码…跟我说一声就行～
              </PText>
              {profile ? (
                <View style={styles.avatarRow}>
                  <AvatarPortrait avatar={profile.avatar} size={48} />
                  <PText size={11} color={C.dim} style={{ flex: 1 }}>
                    现在的你：{describeAvatarLine(profile.avatar)}
                  </PText>
                </View>
              ) : null}
            </View>
          )}
          {msgs.map((m) => (
            <MessageRow key={m.id} m={m} />
          ))}
          {busy && (
            <View style={[styles.bubble, styles.botBubble, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
              <ActivityIndicator size="small" color={C.mint} />
              <PText size={12} color={C.dim}>
                小管家思考中…
              </PText>
            </View>
          )}
        </ScrollView>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.suggestBar}
          contentContainerStyle={{ paddingHorizontal: 10, gap: 6, alignItems: 'center' }}
        >
          {SUGGESTIONS.map((s) => (
            <Pressable
              key={s}
              disabled={busy}
              onPress={() => send(s)}
              style={({ pressed }) => [styles.suggest, pressed && { backgroundColor: C.border }, busy && { opacity: 0.5 }]}
            >
              <PText size={12} color={C.ink}>
                {s}
              </PText>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.inputBar}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="跟小管家说点什么…"
            placeholderTextColor={C.faint}
            maxLength={300}
            multiline
            style={styles.input}
            onSubmitEditing={() => send()}
            returnKeyType="send"
            submitBehavior="submit"
          />
          {busy ? (
            <PButton small title="■ 停" color={C.red} textColor="#fff" onPress={stop} />
          ) : (
            <PButton small title="发送" color={C.mint} disabled={!input.trim()} onPress={() => send()} />
          )}
        </View>
      </KeyboardAvoidingView>
      </View>
    </Screen>
  );
}

function MessageRow({ m }: { m: ChatMsg }) {
  if (m.role === 'user')
    return (
      <View style={[styles.bubble, styles.userBubble]}>
        <PText size={14} color="#14111f" style={{ lineHeight: 20 }} selectable>
          {m.text}
        </PText>
      </View>
    );
  if (m.role === 'assistant')
    return (
      <View style={[styles.bubble, styles.botBubble]}>
        <PText size={14} style={{ lineHeight: 21 }} selectable>
          {m.text}
        </PText>
      </View>
    );
  if (m.role === 'error')
    return (
      <View style={[styles.bubble, styles.botBubble, { borderColor: C.red }]}>
        <PText size={13} color={C.red}>
          ⚠ {m.text}
        </PText>
      </View>
    );
  if (m.role === 'avatar')
    return (
      <View style={[styles.bubble, styles.botBubble, styles.avatarRow, { marginTop: 0 }]}>
        <AvatarPortrait avatar={m.avatar} size={64} />
        <View style={{ flex: 1 }}>
          <PText bold size={12} color={C.mint}>
            新造型 ✨
          </PText>
          <PText size={11} color={C.dim} style={{ marginTop: 4 }}>
            {describeAvatarLine(m.avatar)}
          </PText>
        </View>
      </View>
    );
  return (
    <View style={styles.chips}>
      {m.chips.map((c) => (
        <View key={c.id} style={[styles.chip, { borderColor: CHIP_COLOR[c.state] }]}>
          <PText size={11} color={CHIP_COLOR[c.state]}>
            🔧 {c.label} {c.state === 'run' ? '…' : c.state === 'ok' ? '✓' : c.state === 'ask' ? '？' : '✗'}
          </PText>
        </View>
      ))}
    </View>
  );
}

const CHIP_COLOR: Record<Chip['state'], string> = { run: C.amber, ok: C.mint, err: C.red, ask: C.violet };

const styles = StyleSheet.create({
  modelBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingBottom: 8, borderBottomWidth: 2, borderColor: '#000' },
  dot: { width: 8, height: 8, borderWidth: 1, borderColor: '#000' },
  bubble: { maxWidth: '86%', borderWidth: 2, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: C.amber, borderColor: '#000' },
  botBubble: { alignSelf: 'flex-start', backgroundColor: C.panel, borderColor: C.border },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8, alignSelf: 'flex-start', maxWidth: '90%' },
  chip: { borderWidth: 1, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: C.panel2 },
  suggestBar: { flexGrow: 0, borderTopWidth: 2, borderColor: '#000', paddingVertical: 8, backgroundColor: C.bg },
  suggest: { borderWidth: 2, borderColor: C.border, backgroundColor: C.panel2, paddingHorizontal: 10, paddingVertical: 6 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingBottom: 6, paddingTop: 2, backgroundColor: C.bg },
  input: {
    flex: 1,
    fontFamily: MONO,
    fontSize: 15,
    color: C.ink,
    backgroundColor: C.panel2,
    borderWidth: 2,
    borderColor: C.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    maxHeight: 110,
  },
});
