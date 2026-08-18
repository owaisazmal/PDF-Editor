// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { useTheme } from '@/theme';

export type FileRowState = 'pending' | 'done' | 'failed';

export type FileRowProps = {
  name: string;
  /** Size, dimensions, or the reason it failed. */
  detail: string;
  state: FileRowState;
};

/**
 * One file in a batch listing.
 *
 * State is carried by a labelled marker rather than colour alone: a user who cannot
 * distinguish the green from the red still reads "Done" and "Failed". The marker is
 * also what screen readers announce, so the row reads the same way it looks.
 */
export function FileRow({ name, detail, state }: FileRowProps) {
  const theme = useTheme();

  const { label, ink, background } = {
    pending: { label: 'Waiting', ink: 'textTertiary', background: theme.color.bgSunken },
    done: { label: 'Done', ink: 'successInk', background: theme.color.successBg },
    failed: { label: 'Failed', ink: 'dangerInk', background: theme.color.dangerBg },
  }[state] as { label: string; ink: 'textTertiary' | 'successInk' | 'dangerInk'; background: string };

  return (
    <View
      accessible
      accessibilityLabel={`${name}. ${label}. ${detail}`}
      style={[
        styles.row,
        {
          paddingVertical: theme.space.md,
          borderBottomWidth: StyleSheet.hairlineWidth * 2,
          borderBottomColor: theme.color.borderHairline,
        },
      ]}
    >
      <View style={styles.text}>
        <Text variant="bodySm" numberOfLines={1} accessibilityElementsHidden importantForAccessibility="no">
          {name}
        </Text>
        <Text
          variant="caption"
          color={state === 'failed' ? 'dangerInk' : 'textTertiary'}
          numberOfLines={2}
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{ marginTop: 2 }}
        >
          {detail}
        </Text>
      </View>

      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{
          backgroundColor: background,
          borderRadius: theme.radius.sm,
          paddingHorizontal: theme.space.sm,
          paddingVertical: theme.space.xs,
          marginLeft: theme.space.md,
        }}
      >
        <Text variant="label" color={ink}>
          {label.toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  text: { flex: 1, minWidth: 0 },
});
