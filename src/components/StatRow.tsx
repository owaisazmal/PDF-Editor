// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { StyleSheet, View } from 'react-native';

import { Text, type TextColor } from './Text';
import { useTheme } from '@/theme';

export type StatRowProps = {
  label: string;
  value: string;
  emphasis?: boolean;
  valueColor?: TextColor;
  /**
   * Read to screen readers instead of `label: value`, for values whose written form
   * is not how they should be spoken — "−80%" should be "80 percent smaller".
   */
  accessibilityLabel?: string;
};

/**
 * A label and a figure on one line, with the figure in tabular mono so a column of
 * these stays aligned as values change. Used on the result screen, which is the
 * moment the app has to prove it did something worth sharing.
 */
export function StatRow({ label, value, emphasis, valueColor, accessibilityLabel }: StatRowProps) {
  const theme = useTheme();

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? `${label}: ${value}`}
      style={[
        styles.row,
        {
          paddingVertical: theme.space.md,
          borderBottomWidth: StyleSheet.hairlineWidth * 2,
          borderBottomColor: theme.color.borderHairline,
        },
      ]}
    >
      <Text variant="bodySm" color="textSecondary" accessibilityElementsHidden importantForAccessibility="no">
        {label}
      </Text>
      <Text
        variant={emphasis ? 'monoLg' : 'mono'}
        color={valueColor ?? (emphasis ? 'accentInk' : 'textPrimary')}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
