// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { SectionLabel } from './SectionLabel';
import { Text } from './Text';
import { useTheme } from '@/theme';

export type Segment<T extends string> = {
  value: T;
  label: string;
  /** Spoken instead of the label when the label is too terse to stand alone. */
  accessibilityLabel?: string;
};

/**
 * Stands in for a missing `testID` when building each segment's own id.
 *
 * The visible `label` used to fill that slot, and it comes from the catalogue now: the
 * ids would change with the language, so a test looking for `Rotate-90` would find
 * `Rotar-90` on a Spanish build and nothing at all on an Arabic one. Callers that want
 * to be findable pass `testID`; this only keeps the ids of the ones that do not from
 * being written in whatever language the app happens to be running in.
 */
const TEST_ID_FALLBACK = 'segmented';

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
      {/*
        The same component every other section heading uses, so a segmented control's
        label is not the one heading on a screen in a different case. When SectionLabel
        started uppercasing, this was left behind and the settings screen ended up
        reading "Appearance" above "LANGUAGE" and "ABOUT".
      */}
      <SectionLabel>{label}</SectionLabel>

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
              testID={`${testID ?? TEST_ID_FALLBACK}-${segment.value}`}
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
