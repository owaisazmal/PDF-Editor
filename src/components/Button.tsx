// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Text, type TextColor } from './Text';
import { useTheme } from '@/theme';
import type { ColorTokens } from '@/theme/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  /** Overrides the label for screen readers when the label alone lacks context. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: ViewStyle;
  testID?: string;
};

type Surface = {
  background: keyof ColorTokens | null;
  label: TextColor;
  border: keyof ColorTokens | null;
};

const SURFACES: Record<ButtonVariant, Surface> = {
  primary: { background: 'accentDeep', label: 'textOnAccentDeep', border: null },
  secondary: { background: 'bgSurface', label: 'textPrimary', border: 'borderControl' },
  ghost: { background: null, label: 'accentInk', border: null },
};

/**
 * Meets the 48pt minimum touch target on both platforms, announces its busy and
 * disabled states to VoiceOver and TalkBack rather than only showing them, and dims
 * on press instead of animating — a scale animation on a converter's primary action
 * reads as latency.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: ButtonProps) {
  const theme = useTheme();
  const surface = SURFACES[variant];
  const inactive = disabled || busy;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      accessibilityState={{ disabled: inactive, busy }}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: theme.hitTarget,
          paddingHorizontal: theme.space['2xl'],
          borderRadius: theme.radius.md,
          backgroundColor: surface.background ? theme.color[surface.background] : 'transparent',
          borderWidth: surface.border ? StyleSheet.hairlineWidth * 2 : 0,
          borderColor: surface.border ? theme.color[surface.border] : undefined,
          opacity: inactive ? 0.45 : pressed ? 0.75 : 1,
        },
        variant === 'primary' && !inactive && theme.shadow('sm'),
        style,
      ]}
    >
      <View style={styles.row}>
        {busy ? (
          <ActivityIndicator
            size="small"
            color={theme.color[surface.label === 'textOnAccentDeep' ? 'textOnAccentDeep' : 'accentInk']}
            style={{ marginRight: theme.space.sm }}
          />
        ) : null}
        <Text variant="h3" color={surface.label}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
});
