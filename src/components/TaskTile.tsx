// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { I18nManager, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();

  return (
    <Card
      onPress={enabled ? onPress : undefined}
      testID={testID}
      accessibilityLabel={t('a11y.labelledDetail', { label: title, detail: subtitle })}
      accessibilityHint={enabled ? t('tasks.hint', { from, to }) : t('tasks.unavailableHint')}
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
        {/*
          The arrow is picked rather than mirrored. In RTL the row itself flips, so the
          destination badge is drawn on the left — but U+2192 is not Bidi_Mirrored, so a
          hard-coded → survives the flip pointing the same way and ends up aimed from the
          destination back at the source. Swapping the glyph is the only thing that keeps
          it pointing at the output.
        */}
        <Text variant="mono" color="textTertiary" style={{ marginHorizontal: theme.space.sm }}>
          {I18nManager.isRTL ? '←' : '→'}
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
      {/*
        Three lines rather than two. The subtitle is the only thing on the tile that says
        what the task is for, and at two lines a 1080-wide phone cut "Compress Image" down
        to "Hit a size limit without the guess…" — the clause that carries the meaning was
        the one that got dropped. Tiles in a row already stretch to the tallest, so the
        cost is one row growing on narrow screens, and English is not the widest language
        this has to hold.
      */}
      <Text variant="bodySm" color="textSecondary" numberOfLines={3} style={{ marginTop: theme.space.xs }}>
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
