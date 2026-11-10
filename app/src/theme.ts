import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { TOOLS } from './shared';

export const C = {
  bg: '#0b0d1a',
  panel: '#141834',
  panel2: '#1c2147',
  border: '#2f3670',
  ink: '#e9e6ff',
  dim: '#8a8fc0',
  faint: '#555b8f',
  shadow: '#000000',
  amber: '#ffc85a',
  coral: '#d97757',
  mint: '#78e6be',
  violet: '#aa78ff',
  pink: '#ff5a8c',
  red: '#ff4d5e',
  blue: '#7896ff',
};

export const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string;

export function rgb(c: number[] | undefined, a = 1): string {
  if (!c) return `rgba(160,220,255,${a})`;
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}
export function toolColor(tool: string | null | undefined, a = 1): string {
  return rgb((TOOLS[tool || 'other'] || TOOLS.other).color, a);
}
export function toolLabel(tool: string | null | undefined): string {
  if (!tool) return 'AI';
  return (TOOLS[tool] || { label: tool }).label;
}

export const haptic = {
  tap: () => Haptics.selectionAsync().catch(() => {}),
  bump: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}),
  ok: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
  err: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}),
};
