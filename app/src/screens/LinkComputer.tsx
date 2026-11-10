import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import { Card, ErrorLine, Header, PButton, PText, Screen } from '../components/ui';
import { Session, api, errText, normalizeServer } from '../api';
import { DEFAULT_SERVER } from '../shared';
import { C, MONO, haptic } from '../theme';

export default function LinkComputer({ session, onBack }: { session: Session; onBack: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchCode = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.linkCode(session);
      setCode(r.linkCode);
      // expiresAt is in server time; a fresh code lives 10 min, so clamp to guard against phone clock skew
      const ttl = (r.expiresAt || 0) - Date.now();
      setExpiresAt(Date.now() + (ttl > 0 && ttl <= 10 * 60_000 ? ttl : 10 * 60_000));
      haptic.ok();
    } catch (e) {
      setErr(errText(e));
      haptic.err();
    } finally {
      setBusy(false);
    }
  }, [session]);

  useEffect(() => {
    fetchCode();
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [fetchCode]);

  const left = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const expired = !!code && left === 0;
  const custom = normalizeServer(session.serverUrl) !== DEFAULT_SERVER;
  const command = code
    ? `npx -y github:Shiyao-Huang/whonotsleep link ${code}${custom ? ` --server ${normalizeServer(session.serverUrl)}` : ''}`
    : '';

  return (
    <Screen>
      <Header title="连接电脑 💻" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <PText size={13} color={C.dim} style={{ lineHeight: 20, marginBottom: 12 }}>
          在你的 Mac 上运行下面这行命令。之后你一打开 Claude Code / Codex / Gemini 等 AI 工具，小人就会自动坐到桌前 ⌨️
        </PText>
        <Card style={{ alignItems: 'center' }}>
          <PText size={12} color={C.dim}>
            连接码
          </PText>
          <PText bold size={40} color={expired ? C.faint : C.amber} style={{ letterSpacing: 10, marginVertical: 8 }}>
            {code || '······'}
          </PText>
          <PText size={12} color={expired ? C.red : C.dim}>
            {!code ? (busy ? '生成中…' : '') : expired ? '过期啦，重新生成一个' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} 后过期`}
          </PText>
        </Card>
        {code && !expired ? (
          <Card>
            <PText size={12} color={C.dim} style={{ marginBottom: 6 }}>
              终端命令
            </PText>
            <View style={styles.cmd}>
              <PText selectable size={13} color={C.mint} style={{ fontFamily: MONO }}>
                $ {command}
              </PText>
            </View>
            <PButton
              small
              title="📋 复制 / 分享命令"
              color={C.mint}
              onPress={() => Share.share({ message: command }).catch(() => {})}
              style={{ marginTop: 10 }}
            />
          </Card>
        ) : null}
        <ErrorLine text={err} />
        <PButton title={code ? '🔄 换一个码' : '生成连接码'} loading={busy} onPress={fetchCode} />
        <PText size={11} color={C.faint} style={{ marginTop: 16, lineHeight: 18 }}>
          需要 Node 18+。命令会在后台装一个小守护进程，只上报「在用哪个 AI 工具」和项目名，不上传任何代码。
        </PText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cmd: { backgroundColor: '#05060d', borderWidth: 2, borderColor: '#000', padding: 10 },
});
