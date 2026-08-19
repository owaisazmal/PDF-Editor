// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { Button, Card, Screen, SectionLabel, StatRow, Text } from '@/components';
import { CONVERSION_TASKS } from '@/features/home/tasks';
import { activeLocale } from '@/i18n';
import { useHistoryStore, totalSaved, type HistoryEntry } from '@/store/history';
import { useTheme } from '@/theme';
import { describeSizeChange, formatBytes, formatList, formatNumber } from '@/utils/format';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'History'>;

/**
 * What you have converted.
 *
 * Answers the two questions people come back with: where did that go, and did it
 * actually save anything. It is a record of the work, not of the files — there are no
 * thumbnails here and no paths to anything outside the app, because a history that leaks
 * should reveal nothing but which formats someone uses.
 *
 * The output names are shown because recognising a batch is the point. They are not
 * links: those files may have been moved, renamed or deleted since, and a row that
 * silently fails to open is worse than a row that never promised to.
 */
export function HistoryScreen({ navigation }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const entries = useHistoryStore((state) => state.entries);
  const clear = useHistoryStore((state) => state.clear);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const totals = useMemo(() => totalSaved(entries), [entries]);
  const change = describeSizeChange(totals.before, totals.after);

  const onClear = useCallback(() => {
    if (!confirmingClear) {
      // Two taps rather than a modal. This is destructive but small, and a dialog for
      // every destructive thing trains people to dismiss dialogs.
      setConfirmingClear(true);
      return;
    }
    clear();
    setConfirmingClear(false);
  }, [confirmingClear, clear]);

  return (
    <Screen>
      <Text variant="h1">{t('history.title')}</Text>
      <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.xs }}>
        {entries.length === 0 ? t('history.empty') : t('history.count', { count: entries.length })}
      </Text>

      {entries.length > 0 && totals.before > 0 ? (
        <Card style={{ marginTop: theme.space.lg }} elevation="md">
          <SectionLabel color="textTertiary">{t('history.allTime')}</SectionLabel>
          <View style={{ marginTop: theme.space.sm }}>
            <StatRow label={t('common.before')} value={formatBytes(totals.before)} />
            <StatRow label={t('common.after')} value={formatBytes(totals.after)} />
            <StatRow
              label={t(change.labelKey)}
              value={change.value}
              emphasis
              {...(change.grew ? { valueColor: 'warningInk' as const } : {})}
            />
          </View>
        </Card>
      ) : null}

      <ScrollView
        style={{ flex: 1, marginTop: theme.space.lg }}
        contentContainerStyle={{ paddingBottom: theme.space.xl }}
        showsVerticalScrollIndicator={false}
      >
        {entries.length === 0 ? (
          <Card>
            <Text variant="h3">{t('history.emptyTitle')}</Text>
            <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.xs }}>
              {t('history.emptyBody')}
            </Text>
          </Card>
        ) : (
          entries.map((entry) => <HistoryRow key={entry.id} entry={entry} />)
        )}
      </ScrollView>

      <View style={{ paddingTop: theme.space.md, gap: theme.space.sm }}>
        {entries.length > 0 ? (
          <Button
            label={confirmingClear ? t('history.clearConfirm') : t('history.clear')}
            variant="ghost"
            onPress={onClear}
          />
        ) : null}
        <Button label={t('common.done')} variant="ghost" onPress={() => navigation.popToTop()} />
      </View>
    </Screen>
  );
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const removeEntry = useHistoryStore((state) => state.removeEntry);
  const [expanded, setExpanded] = useState(false);

  const change = describeSizeChange(entry.bytesBefore, entry.bytesAfter);

  // Resolved from the id, so the row is in whatever language is running now. The stored
  // title is only reached for rows written before the catalogue covered this screen, and
  // the id is the last resort: a row that says `merge-pdf` is still better than a blank.
  const task = CONVERSION_TASKS.find((candidate) => candidate.id === entry.taskId);
  const title = task ? t(`tasks.${task.id}.title`) : (entry.taskTitle ?? entry.taskId);

  const whenText = when(entry.at, t, activeLocale());
  const hiddenNames = entry.fileCount - entry.outputNames.length;

  return (
    <Card style={{ marginBottom: theme.space.md }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={t('history.entryLabel', {
          task: title,
          count: entry.fileCount,
          when: whenText,
        })}
        accessibilityHint={t('history.entryHint')}
        onPress={() => setExpanded((open) => !open)}
      >
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text variant="h3" numberOfLines={1}>
              {title}
            </Text>
            <Text variant="caption" color="textTertiary" style={{ marginTop: 2 }}>
              {entry.failedCount > 0
                ? t('history.rowDetailFailed', {
                    when: whenText,
                    count: entry.fileCount,
                    failed: formatNumber(entry.failedCount),
                  })
                : t('history.rowDetail', { when: whenText, count: entry.fileCount })}
            </Text>
          </View>
          {change.value ? (
            <Text variant="mono" color={change.grew ? 'warningInk' : 'successInk'}>
              {change.grew ? '+' : '−'}
              {change.value}
            </Text>
          ) : null}
        </View>
      </Pressable>

      {expanded ? (
        <View style={{ marginTop: theme.space.md }}>
          <StatRow label={t('common.before')} value={formatBytes(entry.bytesBefore)} />
          <StatRow label={t('common.after')} value={formatBytes(entry.bytesAfter)} />

          {entry.outputNames.length > 0 ? (
            <Text variant="caption" color="textTertiary" style={{ marginTop: theme.space.sm }}>
              {hiddenNames > 0
                ? t('history.namesAndMore', {
                    names: formatList(entry.outputNames),
                    count: hiddenNames,
                  })
                : t('history.names', { names: formatList(entry.outputNames) })}
            </Text>
          ) : null}

          <Button
            label={t('common.remove')}
            variant="ghost"
            onPress={() => removeEntry(entry.id)}
            style={{ marginTop: theme.space.sm }}
          />
        </View>
      ) : null}
    </Card>
  );
}

/**
 * Relative for anything recent, absolute once it stops being memorable.
 *
 * "3 hours ago" is how someone thinks about a conversion they are still looking for;
 * a date is how they think about one from last month.
 *
 * `t` and the locale are handed in rather than read here: this sits in module scope and
 * cannot call a hook. The locale is the app's rather than the device's, because
 * `toLocaleDateString()` left to itself prints an English date in the middle of a French
 * row the moment someone sets a per-app language.
 */
function when(at: number, t: TFunction, locale: string): string {
  const elapsed = Date.now() - at;
  const minutes = Math.round(elapsed / 60_000);
  if (minutes < 1) return t('history.justNow');
  if (minutes < 60) return t('history.minutesAgo', { count: minutes });

  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('history.hoursAgo', { count: hours });

  const days = Math.round(hours / 24);
  if (days <= 7) return t('history.daysAgo', { count: days });

  return new Date(at).toLocaleDateString(locale);
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerText: { flex: 1 },
});
