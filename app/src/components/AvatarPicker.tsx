// Avatar editor with a live animated pixel portrait (shared/scene.js renderAvatar).
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Canvas, FilterMode, Image, MipmapMode } from '@shopify/react-native-skia';
import { AVATAR_COUNTS, Avatar, Scene } from '../shared';
import { rgbaToImage, solidFrame } from './rgba';
import { PButton, PText } from './ui';
import { C, haptic } from '../theme';

const SAMPLING = { filter: FilterMode.Nearest, mipmap: MipmapMode.None };
const TRAITS: { key: keyof Avatar; label: string }[] = [
  { key: 'skin', label: '肤色' },
  { key: 'hair', label: '发色' },
  { key: 'hairStyle', label: '发型' },
  { key: 'shirt', label: '衣服' },
  { key: 'accessory', label: '配件' },
];
const ACCESSORY_NAMES = ['无', '眼镜', '耳机', '帽子', '猫耳'];

export function AvatarPortrait({ avatar, size = 128, animate = true }: { avatar: Avatar; size?: number; animate?: boolean }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!animate) return;
    const t0 = Date.now();
    const id = setInterval(() => setT(Date.now() - t0), 150);
    return () => clearInterval(id);
  }, [animate]);
  const image = useMemo(() => {
    try {
      if (Scene.renderAvatar) {
        const img = rgbaToImage(Scene.renderAvatar(avatar, { t, size: 32 }));
        if (img) return img;
      }
    } catch {}
    return null;
  }, [avatar, t]);
  const fallback = useMemo(() => rgbaToImage(solidFrame(32, 32, [28, 33, 71])), []);
  const palette = useMemo(() => {
    try {
      return Scene.avatarPalette?.(avatar) || null;
    } catch {
      return null;
    }
  }, [avatar]);
  return (
    <View style={[styles.portrait, { width: size + 4, height: size + 4 }]}>
      <Canvas style={{ width: size, height: size }}>
        <Image image={image || fallback} x={0} y={0} width={size} height={size} fit="contain" sampling={SAMPLING} />
      </Canvas>
      {!image && (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <View style={{ width: size * 0.35, height: size * 0.35, backgroundColor: palette?.skin || '#e8b48a', borderWidth: 2 }} />
          <View style={{ width: size * 0.5, height: size * 0.3, backgroundColor: palette?.shirt || C.coral, borderWidth: 2 }} />
        </View>
      )}
    </View>
  );
}

/** Small colour swatch for list rows (uses avatarPalette, falls back to a hashed colour). */
export function AvatarSwatch({ avatar, size = 28 }: { avatar: Avatar; size?: number }) {
  const pal = useMemo(() => {
    try {
      return Scene.avatarPalette?.(avatar) || null;
    } catch {
      return null;
    }
  }, [avatar]);
  const fallbackShirt = ['#d97757', '#78e6be', '#7896ff', '#aa78ff', '#ffc85a', '#ff5a8c'][(avatar?.shirt || 0) % 6];
  return (
    <View style={[styles.swatch, { width: size, height: size }]}>
      <View style={{ flex: 1, backgroundColor: pal?.hair || '#3a2a20' }} />
      <View style={{ flex: 1.2, backgroundColor: pal?.skin || '#e8b48a' }} />
      <View style={{ flex: 1.4, backgroundColor: pal?.shirt || fallbackShirt }} />
    </View>
  );
}

export default function AvatarPicker({ value, onChange }: { value: Avatar; onChange: (a: Avatar) => void }) {
  const cycle = (key: keyof Avatar, dir: 1 | -1) => {
    haptic.tap();
    const n = AVATAR_COUNTS[key] || 1;
    onChange({ ...value, [key]: (((value[key] || 0) + dir) % n + n) % n });
  };
  const randomize = () => {
    haptic.bump();
    const a = {} as Avatar;
    for (const { key } of TRAITS) a[key] = Math.floor(Math.random() * (AVATAR_COUNTS[key] || 1));
    onChange(a);
  };
  return (
    <View style={{ alignItems: 'center' }}>
      <AvatarPortrait avatar={value} size={144} />
      <View style={{ width: '100%', marginTop: 12 }}>
        {TRAITS.map(({ key, label }) => (
          <View key={key} style={styles.row}>
            <Pressable hitSlop={8} onPress={() => cycle(key, -1)} style={styles.arrow}>
              <PText bold size={18} color={C.amber}>
                ◀
              </PText>
            </Pressable>
            <PText bold style={{ flex: 1, textAlign: 'center' }}>
              {label} · {key === 'accessory' ? ACCESSORY_NAMES[value.accessory] ?? value.accessory + 1 : (value[key] || 0) + 1}
              {key === 'accessory' ? null : <PText size={12} color={C.dim}>{` / ${AVATAR_COUNTS[key]}`}</PText>}
            </PText>
            <Pressable hitSlop={8} onPress={() => cycle(key, 1)} style={styles.arrow}>
              <PText bold size={18} color={C.amber}>
                ▶
              </PText>
            </Pressable>
          </View>
        ))}
      </View>
      <PButton small title="🎲 随机一个" color={C.violet} onPress={randomize} style={{ marginTop: 4 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  portrait: {
    borderWidth: 2,
    borderColor: '#000',
    backgroundColor: C.panel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  swatch: { borderWidth: 2, borderColor: '#000', overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.panel,
    borderWidth: 2,
    borderColor: C.border,
    marginBottom: 6,
    paddingVertical: 6,
  },
  arrow: { paddingHorizontal: 16, paddingVertical: 4 },
});
