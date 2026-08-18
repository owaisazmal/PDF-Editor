// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button, Card, FileRow, ProgressBar, Screen, StatRow, Text } from '@/components';
import { FORMATS } from '@/engine/formats';
import { fileGateway } from '@/native';
import { isBatchFinished, isBatchRunning, useBatchStore } from '@/store/batch';
import { useTheme } from '@/theme';
import { imageDefaults } from '@/theme/tokens';
import { formatBytes, formatDuration, percentageSaved } from '@/utils/format';
import { CONVERSION_TASKS } from '../home/tasks';
import { errorMessage } from '../convert/errors';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Batch'>;

export function BatchScreen({ route, navigation }: Props) {
  const theme = useTheme();
  const batch = useBatchStore();
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const task = useMemo(
    () => CONVERSION_TASKS.find((t) => t.id === route.params.taskId),
    [route.params.taskId],
  );

  const running = isBatchRunning(batch.status);
  const finished = isBatchFinished(batch.status);

  // Submitted here rather than in the picker so the screen is mounted and listening
  // before the first progress event can arrive.
  useEffect(() => {
    if (!task || batch.status !== 'idle' || batch.sources.length === 0) return;
    void batch.start(batch.sources, {
      targetFormat: task.targetFormat,
      quality: 82,
      background: { color: imageDefaults.backgroundFill },
    });
  }, [task, batch]);

  useEffect(() => {
    if (batch.status === 'completed') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [batch.status]);

  /**
   * The list the user picked, in the order they picked it, with each file's outcome
   * filled in as it arrives.
   *
   * Rendering results in arrival order instead means a list that reshuffles while the
   * user is reading it — the queue is concurrent, so completion order is arbitrary and
   * unstable between runs. Anchoring on the selection also means a file that has not
   * been reached yet still has a row, which is better feedback than an empty space.
   */
  const rows = useMemo(() => {
    const resultByIndex = new Map(batch.results.map((result) => [result.sourceIndex, result]));
    const failureByIndex = new Map(batch.failures.map((failure) => [failure.sourceIndex, failure]));

    return batch.sources.map((source, index) => {
      const result = resultByIndex.get(index);
      if (result) {
        return {
          key: `${index}-done`,
          name: result.outputDisplayName,
          detail: formatBytes(result.byteSize),
          state: 'done' as const,
        };
      }
      const failure = failureByIndex.get(index);
      if (failure) {
        return {
          key: `${index}-failed`,
          name: failure.displayName || source.displayName,
          detail: errorMessage(failure.code),
          state: 'failed' as const,
        };
      }
      return {
        key: `${index}-pending`,
        name: source.displayName,
        detail: formatBytes(source.byteSize),
        state: 'pending' as const,
      };
    });
  }, [batch.sources, batch.results, batch.failures]);

  const totals = useMemo(() => {
    const before = batch.sources.reduce((sum, source) => sum + source.byteSize, 0);
    const after = batch.results.reduce((sum, result) => sum + result.byteSize, 0);
    const elapsed = batch.results.reduce((sum, result) => sum + result.elapsedMs, 0);
    return { before, after, elapsed };
  }, [batch.sources, batch.results]);

  const onSave = useCallback(async () => {
    setSaveError(null);
    try {
      await fileGateway.saveToPhotos(batch.results.map((result) => result.outputUri));
      setSaved(true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  }, [batch.results]);

  const onDone = useCallback(() => {
    batch.reset();
    setSaved(false);
    navigation.popTo('Home');
  }, [batch, navigation]);

  if (!task) {
    return (
      <Screen>
        <Text variant="h2">Nothing to convert</Text>
        <Button label="Back" variant="secondary" onPress={onDone} style={{ marginTop: theme.space['2xl'] }} />
      </Screen>
    );
  }

  const targetLabel = FORMATS[task.targetFormat].label;
  const { progress } = batch;

  return (
    <Screen>
      <Text variant="h1">{task.title}</Text>
      <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.xs }}>
        {progress.totalCount} {progress.totalCount === 1 ? 'file' : 'files'} → {targetLabel}
      </Text>

      <Card style={{ marginTop: theme.space.xl }}>
        <ProgressBar
          fraction={progress.fraction}
          accessibilityLabel={
            running
              ? `Converting. ${progress.completedCount} of ${progress.totalCount} done.`
              : `Finished. ${progress.completedCount} of ${progress.totalCount} converted.`
          }
        />

        <View style={{ marginTop: theme.space.md, flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="mono" color="textSecondary">
            {progress.completedCount + progress.failedCount} / {progress.totalCount}
          </Text>
          <Text variant="mono" color={progress.failedCount > 0 ? 'dangerInk' : 'textTertiary'}>
            {progress.failedCount > 0 ? `${progress.failedCount} failed` : `${Math.round(progress.fraction * 100)}%`}
          </Text>
        </View>

        {running && progress.currentDisplayName ? (
          <Text variant="caption" color="textTertiary" numberOfLines={1} style={{ marginTop: theme.space.sm }}>
            {batch.status === 'cancelling' ? 'Finishing the current file…' : progress.currentDisplayName}
          </Text>
        ) : null}
      </Card>

      {batch.status === 'cancelled' ? (
        // A batch stopped from the notification comes back to a screen that would
        // otherwise look like a finished one that inexplicably did 40 of 48. Saying
        // what happened, and that the finished files are still here, is the difference
        // between a deliberate stop and an apparent malfunction.
        <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.md }}>
          Stopped. The {batch.results.length}{' '}
          {batch.results.length === 1 ? 'file' : 'files'} already converted are below —
          the rest were left alone.
        </Text>
      ) : null}

      {running && batch.backgroundProgress === 'blocked' ? (
        // Stated once, quietly, and only while it is true. Notifications being off
        // changes nothing about whether the batch finishes — saying so is the whole
        // point of the line, because an unexplained missing notification reads as an
        // app that quietly stopped working.
        <Text
          variant="caption"
          color="textTertiary"
          style={{ marginTop: theme.space.sm }}
        >
          Notifications are off, so this won’t appear in your shade. It still finishes if
          you leave the app.
        </Text>
      ) : null}

      {finished && batch.results.length > 0 ? (
        <Card style={{ marginTop: theme.space.lg }} elevation="md">
          <Text variant="label" color="textTertiary">
            TOTAL
          </Text>
          <View style={{ marginTop: theme.space.sm }}>
            <StatRow label="Before" value={formatBytes(totals.before)} />
            <StatRow label="After" value={formatBytes(totals.after)} />
            <StatRow
              label={totals.after > totals.before ? 'Larger by' : 'Saved'}
              value={`${Math.abs(percentageSaved(totals.before, totals.after))}%`}
              emphasis
              {...(totals.after > totals.before ? { valueColor: 'warningInk' as const } : {})}
            />
            <StatRow label="Took" value={formatDuration(totals.elapsed)} />
          </View>
        </Card>
      ) : null}

      {batch.submitError ? (
        <Card style={{ marginTop: theme.space.lg }}>
          <Text variant="h3" color="dangerInk">
            Could not start
          </Text>
          <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.xs }}>
            {batch.submitError}
          </Text>
        </Card>
      ) : null}

      {saveError ? (
        <Card style={{ marginTop: theme.space.lg }}>
          <Text variant="bodySm" color="dangerInk">
            {saveError}
          </Text>
        </Card>
      ) : null}

      <ScrollView
        style={{ flex: 1, marginTop: theme.space.lg }}
        contentContainerStyle={{ paddingBottom: theme.space.xl }}
        showsVerticalScrollIndicator={false}
      >
        {rows.map((row) => (
          <FileRow key={row.key} name={row.name} detail={row.detail} state={row.state} />
        ))}
      </ScrollView>

      <View style={{ gap: theme.space.md, paddingTop: theme.space.md }}>
        {running ? (
          <Button
            testID="cancel-button"
            label={batch.status === 'cancelling' ? 'Cancelling…' : 'Cancel'}
            variant="secondary"
            busy={batch.status === 'cancelling'}
            onPress={() => void batch.cancel()}
          />
        ) : (
          <>
            {batch.results.length > 0 ? (
              <Button
                testID="save-button"
                label={saved ? `Saved ${batch.results.length} to Photos` : `Save ${batch.results.length} to Photos`}
                onPress={() => void onSave()}
                disabled={saved}
              />
            ) : null}
            {batch.failures.length > 0 ? (
              <Button
                testID="retry-button"
                label={`Retry ${batch.failures.length} failed`}
                variant="secondary"
                onPress={() => void batch.retryFailed()}
              />
            ) : null}
            <Button label="Done" variant="ghost" onPress={onDone} />
          </>
        )}
      </View>
    </Screen>
  );
}
