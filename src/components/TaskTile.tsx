// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { StyleSheet, View } from 'react-native';

import { Card } from './Card';
import { Text } from './Text';
import { useTheme } from '@/theme';

export type TaskTileProps = {
  /** The task in the user's words: "HEIC to JPG", not "Raster transcode". */
  title: string;
  /** What it does, one short line. */
  subtitle: string;
  /** Source and destination shown as a format pair, in mono. */
  from: string;
  to: string;
  onPress: () => void;
  enabled?: boolean;
  testID?: string | undefined;
};

/**
 * The home screen's unit: one task, one tap.
 *
 * Home is a grid of these rather than a format matrix, because people arrive knowing
 * the job ("get these off my iPhone as JPGs") and not the taxonomy. Each title is also
 * the phrase people search the stores for, which is why they read as queries.
 */
export function TaskTile({
  title,
  subtitle,
  from,
  to,
  onPress,
  enabled = true,
  testID,
}: TaskTileProps) {
  const theme = useTheme();

  return (
    <Card
      onPress={enabled ? onPress : undefined}
      testID={testID}
      accessibilityLabel={`${title}. ${subtitle}`}
      accessibilityHint={enabled ? `Converts ${from} files to ${to}` : 'Not available on this device'}
      style={StyleSheet.flatten([styles.tile, !enabled && styles.disabled])}
    >
      <View style={[styles.pair, { marginBottom: theme.space.md }]}>
        <View
          style={{
            backgroundColor: theme.color.accentFill,
            borderRadius: theme.radius.sm,
            paddingHorizontal: theme.space.sm,
            paddingVertical: theme.space.xs,
          }}
        >
          <Text variant="mono" color="textOnAccent">
            {from}
          </Text>
        </View>
        <Text variant="mono" color="textTertiary" style={{ marginHorizontal: theme.space.sm }}>
          →
        </Text>
        <View
          style={{
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: theme.color.borderControl,
            borderRadius: theme.radius.sm,
            paddingHorizontal: theme.space.sm,
            paddingVertical: theme.space.xs,
          }}
        >
          <Text variant="mono" color="textSecondary">
            {to}
          </Text>
        </View>
      </View>

      <Text variant="h3" numberOfLines={2}>
        {title}
      </Text>
      <Text variant="bodySm" color="textSecondary" numberOfLines={2} style={{ marginTop: theme.space.xs }}>
        {subtitle}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, minHeight: 148 },
  disabled: { opacity: 0.5 },
  pair: { flexDirection: 'row', alignItems: 'center' },
});
