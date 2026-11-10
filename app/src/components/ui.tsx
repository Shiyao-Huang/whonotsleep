import React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { C, MONO, haptic } from '../theme';

export function Screen({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  // react-native-safe-area-context is not installed: iOS uses RN's SafeAreaView,
  // Android (edge-to-edge) pads by the status bar height and a nav-bar allowance.
  if (Platform.OS === 'ios') {
    return (
      <SafeAreaView style={[styles.screen, style]}>
        <View style={{ flex: 1 }}>{children}</View>
      </SafeAreaView>
    );
  }
  return (
    <View style={[styles.screen, { paddingTop: (StatusBar.currentHeight || 24) + 4, paddingBottom: 16 }, style]}>
      {children}
    </View>
  );
}

export function PText({
  children,
  style,
  size = 14,
  color = C.ink,
  bold,
  numberOfLines,
  onPress,
  selectable,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  size?: number;
  color?: string;
  bold?: boolean;
  numberOfLines?: number;
  onPress?: () => void;
  selectable?: boolean;
}) {
  return (
    <Text
      selectable={selectable}
      numberOfLines={numberOfLines}
      onPress={onPress}
      style={[
        { fontFamily: MONO, fontSize: size, color, letterSpacing: size >= 18 ? 1.5 : 0.5 },
        bold && { fontWeight: '800' },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function PButton({
  title,
  onPress,
  color = C.amber,
  textColor = '#14111f',
  disabled,
  loading,
  small,
  style,
}: {
  title: string;
  onPress?: () => void;
  color?: string;
  textColor?: string;
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || loading;
  return (
    <Pressable
      disabled={off}
      onPress={() => {
        haptic.tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.btnWrap,
        style,
        { transform: [{ translateX: pressed ? 3 : 0 }, { translateY: pressed ? 3 : 0 }] },
      ]}
    >
      {({ pressed }) => (
        <>
          {!pressed && <View style={[styles.btnShadow, small && { borderRadius: 2 }]} />}
          <View
            style={[
              styles.btn,
              small && styles.btnSmall,
              { backgroundColor: off ? C.faint : color },
            ]}
          >
            {loading ? (
              <ActivityIndicator color={textColor} size="small" />
            ) : (
              <PText bold size={small ? 13 : 16} color={textColor} style={{ textAlign: 'center' }} numberOfLines={1}>
                {title}
              </PText>
            )}
          </View>
        </>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function PInput(props: TextInputProps & { label?: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: 12 }}>
      {label ? (
        <PText size={12} color={C.dim} style={{ marginBottom: 6 }}>
          {label}
        </PText>
      ) : null}
      <TextInput
        placeholderTextColor={C.faint}
        autoCorrect={false}
        {...rest}
        style={[styles.input, style]}
      />
    </View>
  );
}

export function Header({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable
          hitSlop={12}
          onPress={() => {
            haptic.tap();
            onBack();
          }}
        >
          <PText bold size={18} color={C.amber}>
            ◀ 返回
          </PText>
        </Pressable>
      ) : (
        <View />
      )}
      <PText bold size={16} style={{ flex: 1, textAlign: 'center' }} numberOfLines={1}>
        {title}
      </PText>
      <View style={{ minWidth: 60, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

export function ErrorLine({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <PText size={13} color={C.red} style={{ marginVertical: 8 }}>
      ⚠ {text}
    </PText>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  btnWrap: { marginRight: 3, marginBottom: 3 },
  btnShadow: {
    position: 'absolute',
    left: 3,
    top: 3,
    right: -3,
    bottom: -3,
    backgroundColor: C.shadow,
    borderRadius: 3,
  },
  btn: {
    borderWidth: 2,
    borderColor: '#000',
    borderRadius: 3,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  btnSmall: { paddingVertical: 6, paddingHorizontal: 10, minHeight: 34 },
  card: {
    backgroundColor: C.panel,
    borderWidth: 2,
    borderColor: C.border,
    borderRadius: 3,
    padding: 12,
    marginBottom: 12,
  },
  input: {
    fontFamily: MONO,
    fontSize: 16,
    color: C.ink,
    backgroundColor: C.panel2,
    borderWidth: 2,
    borderColor: C.border,
    borderRadius: 3,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
});
