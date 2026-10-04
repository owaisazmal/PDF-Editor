// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { ActivityIndicator, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card } from './Card';
import { ProgressBar } from './ProgressBar';
import { Text } from './Text';
import { useTheme } from '@/theme';
import { formatDuration, formatNumber, formatPercent } from '@/utils/format';
import { useAnnouncement } from '@/utils/useAnnouncement';
import { useProgressClock, type ProgressClock } from '@/utils/useProgressClock';

export type LoaderProps = {
  /** What is happening, as a sentence: "Getting your files ready…". */
  title: string;
  /** Units finished and in all. Left out, or a total of one, shows time spent instead. */
  done?: number;
  total?: number;
  style?: ViewStyle | undefined;
  testID?: string | undefined;
};

/** "About 12s left" once the rate is known, and what to say before that. */
export function useWaitLabel(clock: ProgressClock, counted: boolean): string {
  const { t } = useTranslation();
  if (!counted) {
    return clock.elapsedMs >= 1000
      ? t('loader.elapsed', { time: formatDuration(clock.elapsedMs) })
      : '';
  }
  if (clock.remainingMs === null) return t('loader.estimating');
  // Never "0s left" while it is still going.
  return t('loader.remaining', { time: formatDuration(Math.max(1000, clock.remainingMs)) });
}

/**
 * Shown while the app is working: how far along it is and how long is left when the work
 * can be counted, and how long it has been when it cannot.
 */
export function Loader({ title, done = 0, total = 0, style, testID }: LoaderProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const counted = total > 1;
  const fraction = counted ? Math.min(1, done / total) : undefined;
  const clock = useProgressClock(true, fraction);
  const wait = useWaitLabel(clock, counted);
  const count = { done: formatNumber(done), total: formatNumber(total) };

  // Once, when it appears: nothing was tapped, so a screen reader would say nothing.
  useAnnouncement(title);

  return (
    <Card style={style} testID={testID}>
      <View style={styles.row}>
        <ActivityIndicator size="small" color={theme.color.accentInk} />
        <Text
          variant="h3"
          numberOfLines={2}
          style={[styles.title, { marginHorizontal: theme.space.md }]}
        >
          {title}
        </Text>
        {fraction !== undefined ? (
          <Text variant="mono" color="textTertiary">
            {formatPercent(fraction)}
          </Text>
        ) : null}
      </View>

      {fraction !== undefined ? (
        <View style={{ marginTop: theme.space.md }}>
          <ProgressBar fraction={fraction} accessibilityLabel={t('loader.progress', count)} />
        </View>
      ) : null}

      {counted || wait ? (
        <View style={[styles.row, styles.apart, { marginTop: theme.space.md }]}>
          <Text variant="mono" color="textSecondary">
            {counted ? t('batch.progressCount', count) : ''}
          </Text>
          <Text variant="caption" color="textTertiary">
            {wait}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

/** The loader over a dimmed screen, for work that has no screen of its own yet. */
export function LoaderOverlay(props: LoaderProps) {
  const theme = useTheme();
  return (
    <View
      accessibilityViewIsModal
      style={[
        StyleSheet.absoluteFill,
        styles.overlay,
        { backgroundColor: theme.color.bgScrim, padding: theme.space.xl },
      ]}
    >
      <Loader {...props} style={styles.overlayCard} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  apart: { justifyContent: 'space-between' },
  title: { flex: 1 },
  overlay: { alignItems: 'center', justifyContent: 'center' },
  overlayCard: { alignSelf: 'stretch', maxWidth: 480, width: '100%' },
});
