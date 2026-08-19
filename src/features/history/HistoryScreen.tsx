// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button, Card, Screen, StatRow, Text } from '@/components';
import { useHistoryStore, totalSaved, type HistoryEntry } from '@/store/history';
import { useTheme } from '@/theme';
import { describeSizeChange, formatBytes } from '@/utils/format';
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
      <Text variant="h1">History</Text>
      <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.xs }}>
        {entries.length === 0
          ? 'Nothing converted yet'
          : `${entries.length} ${entries.length === 1 ? 'conversion' : 'conversions'}, on this device only`}
      </Text>

      {entries.length > 0 && totals.before > 0 ? (
        <Card style={{ marginTop: theme.space.lg }} elevation="md">
          <Text variant="label" color="textTertiary">
            ALL TIME
          </Text>
          <View style={{ marginTop: theme.space.sm }}>
            <StatRow label="Before" value={formatBytes(totals.before)} />
            <StatRow label="After" value={formatBytes(totals.after)} />
            <StatRow
              label={change.label}
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
            <Text variant="h3">Nothing here yet</Text>
            <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.xs }}>
              Conversions you run will be listed here, on this device. Nothing is uploaded
              and nothing is shared.
            </Text>
          </Card>
        ) : (
          entries.map((entry) => <HistoryRow key={entry.id} entry={entry} />)
        )}
      </ScrollView>

      <View style={{ paddingTop: theme.space.md, gap: theme.space.sm }}>
        {entries.length > 0 ? (
          <Button
            label={confirmingClear ? 'Tap again to clear everything' : 'Clear history'}
            variant="ghost"
            onPress={onClear}
          />
        ) : null}
        <Button label="Done" variant="ghost" onPress={() => navigation.popToTop()} />
      </View>
    </Screen>
  );
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const theme = useTheme();
  const removeEntry = useHistoryStore((state) => state.removeEntry);
  const [expanded, setExpanded] = useState(false);

  const change = describeSizeChange(entry.bytesBefore, entry.bytesAfter);

  return (
    <Card style={{ marginBottom: theme.space.md }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${entry.taskTitle}, ${entry.fileCount} files, ${when(entry.at)}`}
        accessibilityHint="Shows the file names and lets you remove this entry"
        onPress={() => setExpanded((open) => !open)}
      >
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text variant="h3" numberOfLines={1}>
              {entry.taskTitle}
            </Text>
            <Text variant="caption" color="textTertiary" style={{ marginTop: 2 }}>
              {when(entry.at)} · {entry.fileCount}{' '}
              {entry.fileCount === 1 ? 'file' : 'files'}
              {entry.failedCount > 0 ? ` · ${entry.failedCount} failed` : ''}
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
          <StatRow label="Before" value={formatBytes(entry.bytesBefore)} />
          <StatRow label="After" value={formatBytes(entry.bytesAfter)} />

          {entry.outputNames.length > 0 ? (
            <Text
              variant="caption"
              color="textTertiary"
              style={{ marginTop: theme.space.sm }}
            >
              {entry.outputNames.join(', ')}
              {entry.fileCount > entry.outputNames.length
                ? ` and ${entry.fileCount - entry.outputNames.length} more`
                : ''}
            </Text>
          ) : null}

          <Button
            label="Remove"
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
 */
function when(at: number): string {
  const elapsed = Date.now() - at;
  const minutes = Math.round(elapsed / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  const days = Math.round(hours / 24);
  if (days <= 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;

  return new Date(at).toLocaleDateString();
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerText: { flex: 1 },
});
