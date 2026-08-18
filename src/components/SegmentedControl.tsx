// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Text } from './Text';
import { useTheme } from '@/theme';

export type Segment<T extends string> = {
  value: T;
  label: string;
  /** Spoken instead of the label when the label is too terse to stand alone. */
  accessibilityLabel?: string;
};

export type SegmentedControlProps<T extends string> = {
  label: string;
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: ViewStyle;
  testID?: string;
};

/**
 * A small set of mutually exclusive choices.
 *
 * Selection is carried by fill *and* text weight, never fill alone, so the active
 * segment is still identifiable without colour perception. Each segment is its own
 * button with a `selected` state rather than one control reporting an index, because
 * that is what screen readers on both platforms read most usefully.
 */
export function SegmentedControl<T extends string>({
  label,
  segments,
  value,
  onChange,
  style,
  testID,
}: SegmentedControlProps<T>) {
  const theme = useTheme();

  return (
    <View style={style} testID={testID}>
      <Text variant="label" color="textSecondary">
        {label}
      </Text>

      <View
        style={[
          styles.group,
          {
            marginTop: theme.space.sm,
            backgroundColor: theme.color.bgSunken,
            borderRadius: theme.radius.md,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: theme.color.borderHairline,
          },
        ]}
      >
        {segments.map((segment) => {
          const selected = segment.value === value;
          return (
            <Pressable
              key={segment.value}
              testID={`${testID ?? label}-${segment.value}`}
              onPress={() => onChange(segment.value)}
              accessibilityRole="button"
              accessibilityLabel={segment.accessibilityLabel ?? segment.label}
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.segment,
                {
                  minHeight: theme.hitTarget - 8,
                  borderRadius: theme.radius.sm,
                  margin: 3,
                  backgroundColor: selected ? theme.color.accentDeep : 'transparent',
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <Text
                variant={selected ? 'label' : 'caption'}
                color={selected ? 'textOnAccentDeep' : 'textSecondary'}
                numberOfLines={1}
              >
                {segment.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row' },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
});
