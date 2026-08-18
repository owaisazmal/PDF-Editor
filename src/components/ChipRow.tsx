// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from './Text';
import { useTheme } from '@/theme';

export type Chip<T extends string | number> = {
  value: T;
  label: string;
  /** Read out after the label, so a screen reader hears what the choice means. */
  detail?: string;
};

export type ChipRowProps<T extends string | number> = {
  chips: readonly Chip<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the group for assistive technology; not drawn. */
  accessibilityLabel: string;
  testIDPrefix?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * A wrapping row of single-choice chips.
 *
 * Used where a `SegmentedControl` would not fit: seven paper sizes do not go across a
 * phone in one line, and squeezing them there makes every label unreadable. Wrapping
 * keeps each one at a full tap target.
 */
export function ChipRow<T extends string | number>({
  chips,
  value,
  onChange,
  accessibilityLabel,
  testIDPrefix,
  style,
}: ChipRowProps<T>) {
  const theme = useTheme();

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={[styles.row, style]}>
      {chips.map((chip) => {
        const selected = chip.value === value;
        return (
          <Pressable
            key={String(chip.value)}
            {...(testIDPrefix ? { testID: `${testIDPrefix}-${chip.value}` } : {})}
            accessibilityRole="radio"
            accessibilityLabel={chip.detail ? `${chip.label}. ${chip.detail}` : chip.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(chip.value)}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: selected ? theme.color.accentDeep : theme.color.bgSunken,
                borderRadius: theme.radius.pill,
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: selected ? theme.color.accentDeep : theme.color.borderHairline,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Text variant="label" color={selected ? 'textOnAccentDeep' : 'textSecondary'}>
              {chip.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { paddingHorizontal: 16, paddingVertical: 10 },
});
