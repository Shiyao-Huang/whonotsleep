// Live animated pixel room: renders shared/scene.js frames into Skia at ~14 fps,
// scaled with nearest-neighbour sampling, plus RN text overlays (names, Chinese
// speech bubbles) placed via memberAnchors, and tap-to-select hit testing.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, GestureResponderEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { Canvas, FilterMode, Image, MipmapMode, SkImage } from '@shopify/react-native-skia';
import { Anchor, DerivedScene, LAYOUTS, LayoutName, Room, Scene, deriveScene } from '../shared';
import { rgbaToImage, solidFrame } from './rgba';
import { C, MONO } from '../theme';

const FRAME_MS = 70;
const SAMPLING = { filter: FilterMode.Nearest, mipmap: MipmapMode.None };

type Props = {
  room: Room | null;
  /** serverNow - Date.now(), so derived state matches the server clock. */
  clockSkew?: number;
  layout?: LayoutName;
  focusId?: string | null;
  selectedId?: string | null;
  meId?: string | null;
  onSelectMember?: (id: string | null) => void;
};

let loggedError = false;

function fallbackAnchors(d: DerivedScene, layout: LayoutName): Anchor[] {
  const { w, h } = LAYOUTS[layout];
  const n = Math.max(1, Math.min(6, d.members.length));
  return d.members.map((m, i) => {
    const seat = typeof m.seat === 'number' ? m.seat % 6 : i;
    const sleeping = m.pose === 'sleeping';
    return {
      id: m.id,
      x: sleeping ? w * 0.1 + (i % 3) * 10 : ((seat % n) + 0.5) * (w / n),
      y: sleeping ? h * 0.62 : h * 0.42,
    };
  });
}

function getAnchors(d: DerivedScene, layout: LayoutName): Anchor[] {
  try {
    const a = Scene.memberAnchors?.(d, layout);
    if (Array.isArray(a) && a.length) return a;
  } catch {}
  return fallbackAnchors(d, layout);
}

export default function PixelScene({
  room,
  clockSkew = 0,
  layout = 'room',
  focusId = null,
  selectedId = null,
  meId = null,
  onSelectMember,
}: Props) {
  const base = LAYOUTS[layout];
  const [width, setWidth] = useState(0);
  const [image, setImage] = useState<SkImage | null>(null);
  const [derived, setDerived] = useState<DerivedScene | null>(null);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const roomRef = useRef(room);
  roomRef.current = room;
  const skewRef = useRef(clockSkew);
  skewRef.current = clockSkew;
  const fallback = useMemo(() => rgbaToImage(solidFrame(base.w, base.h)), [base.w, base.h]);
  const scale = width / base.w;
  const height = Math.round(base.h * scale);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const t0 = Date.now();
    let lastKey = '';
    const tick = () => {
      const r = roomRef.current;
      if (!r) return;
      const now = Date.now() + skewRef.current;
      let d: DerivedScene;
      try {
        d = deriveScene(r, now);
      } catch {
        return;
      }
      let img: SkImage | null = null;
      try {
        if (Scene.renderScene) img = rgbaToImage(Scene.renderScene(d, { layout, t: Date.now() - t0, focusId }));
      } catch (e) {
        if (!loggedError) {
          loggedError = true;
          console.warn('[wns] renderScene failed', e);
        }
      }
      setImage(img);
      const a = getAnchors(d, layout);
      const key =
        a.map((p) => `${p.id}:${Math.round(p.x)}:${Math.round(p.y)}`).join('|') +
        d.members.map((m) => `${m.name}${m.activeSay?.at || ''}${m.badge || ''}`).join('|');
      if (key !== lastKey) {
        lastKey = key;
        setAnchors(a);
        setDerived(d);
      }
    };
    const start = () => {
      if (!timer) {
        tick();
        timer = setInterval(tick, FRAME_MS);
      }
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
    return () => {
      stop();
      sub.remove();
    };
  }, [layout, focusId]);

  const onPress = (e: GestureResponderEvent) => {
    if (!onSelectMember || !scale || !derived) return;
    const bx = e.nativeEvent.locationX / scale;
    const by = e.nativeEvent.locationY / scale;
    let best: string | null = null;
    let bestD = 22 * 22;
    for (const a of anchors) {
      // anchors are head positions; the body extends ~14px below
      const dx = bx - a.x;
      const dy = by - Math.min(Math.max(by, a.y - 4), a.y + 14);
      const dist = dx * dx + dy * dy;
      if (dist < bestD) {
        bestD = dist;
        best = a.id;
      }
    }
    onSelectMember(best);
  };

  const byId = new Map((derived?.members || []).map((m) => [m.id, m]));
  // keep name tags from overlapping when 5-6 desks share a narrow screen
  const nameMax = Math.max(44, Math.min(110, width / Math.max(1, anchors.length) - 4));

  return (
    <View
      style={[styles.wrap, { height: height || undefined, aspectRatio: height ? undefined : base.w / base.h }]}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
    >
      {width > 0 && (
        <Pressable onPress={onPress} style={StyleSheet.absoluteFill}>
          <Canvas style={{ width, height }} pointerEvents="none">
            <Image image={image || fallback} x={0} y={0} width={width} height={height} fit="fill" sampling={SAMPLING} />
          </Canvas>
          {anchors.map((a) => {
            const m = byId.get(a.id);
            if (!m) return null;
            const x = a.x * scale;
            const y = a.y * scale;
            const selected = a.id === selectedId;
            const say = m.activeSay?.text;
            return (
              <View key={a.id} pointerEvents="none" style={[styles.anchor, { left: say ? Math.max(-20, Math.min(width - 120, x - 70)) : x - 70, bottom: height - (y - 7 * scale) }]}>
                {say ? (
                  <View style={styles.bubble}>
                    <Text style={styles.bubbleText} numberOfLines={3}>
                      {say}
                    </Text>
                    <View style={styles.bubbleTail} />
                  </View>
                ) : null}
                <View
                  style={[
                    styles.name,
                    a.id === meId && { borderColor: C.amber },
                    selected && { backgroundColor: C.amber, borderColor: '#000' },
                    { maxWidth: nameMax },
                  ]}
                >
                  <Text style={[styles.nameText, selected && { color: '#14111f' }]} numberOfLines={1}>
                    {m.badge === 'caught' ? '❗' : ''}
                    {m.name}
                  </Text>
                </View>
              </View>
            );
          })}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', backgroundColor: C.bg, overflow: 'hidden' },
  anchor: { position: 'absolute', width: 140, alignItems: 'center' },
  name: {
    backgroundColor: 'rgba(11,13,26,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
    maxWidth: 110,
  },
  nameText: { fontFamily: MONO, fontSize: 10, fontWeight: '800', color: C.ink },
  bubble: {
    backgroundColor: '#fffbe8',
    borderWidth: 2,
    borderColor: '#000',
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginBottom: 6,
    maxWidth: 136,
  },
  bubbleText: { fontSize: 12, fontWeight: '700', color: '#14111f' },
  bubbleTail: {
    position: 'absolute',
    bottom: -6,
    left: '50%',
    marginLeft: -4,
    width: 8,
    height: 8,
    backgroundColor: '#fffbe8',
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: '#000',
    transform: [{ rotate: '45deg' }],
  },
});
