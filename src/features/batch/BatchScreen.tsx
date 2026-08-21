// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button, Card, FileRow, ProgressBar, Screen, SectionLabel, StatRow, Text } from '@/components';
import { FORMATS } from '@/engine/formats';
import { fileGateway } from '@/native';
import { isBatchFinished, isBatchRunning, useBatchStore } from '@/store/batch';
import { optionsForTask } from '@/store/options';
import { useTheme } from '@/theme';
import {
  describeSizeChange,
  formatBytes,
  formatDuration,
  formatNumber,
  formatPercent,
} from '@/utils/format';
import { CONVERSION_TASKS } from '../home/tasks';
import { errorKey, errorKeyFor, type ErrorKey } from '../convert/errors';
import { useRecordConversion } from '../history/recording';
import { useAnnouncement } from '@/utils/useAnnouncement';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Batch'>;

export function BatchScreen({ route, navigation }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const batch = useBatchStore();
  const [saved, setSaved] = useState(false);
  // A key, not a sentence: the gateway rejects with English written for the console, and
  // that text has no translation to fall back to.
  const [saveError, setSaveError] = useState<ErrorKey | null>(null);

  const task = useMemo(
    // Not `t` for the parameter any more: it would shadow the translator two lines up.
    () => CONVERSION_TASKS.find((candidate) => candidate.id === route.params.taskId),
    [route.params.taskId],
  );

  const running = isBatchRunning(batch.status);
  const finished = isBatchFinished(batch.status);

  // Submitted here rather than in the picker so the screen is mounted and listening
  // before the first progress event can arrive.
  useEffect(() => {
    if (!task || batch.status !== 'idle' || batch.sources.length === 0) return;
    void batch.start(batch.sources, optionsForTask(task));
  }, [task, batch]);

  useEffect(() => {
    if (batch.status === 'completed') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [batch.status]);

  // A cancelled batch is recorded too: the files it did convert are real, and they are
  // exactly the ones somebody comes back looking for.
  useRecordConversion(task, finished, batch.sources, batch.results, batch.failures.length);

  /**
   * Spoken when the batch reaches a state worth knowing about.
   *
   * Not on every progress tick: ten sentences a second is not information. Only the
   * outcome, which is the thing a user who cannot see the bar is waiting for.
   *
   * Two sentences rather than one, because the failure half pluralises on its own and
   * only exists sometimes. Written as one key it would have needed a variant for every
   * plural category with and without failures.
   */
  useAnnouncement(
    finished
      ? t('batch.announceFinished', {
          done: formatNumber(batch.progress.completedCount),
          total: formatNumber(batch.progress.totalCount),
        }) +
          (batch.failures.length > 0
            ? ` ${t('batch.announceFailures', { count: batch.failures.length })}`
            : '')
      : null,
  );

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
          detail: t(errorKey(failure.code)),
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
  }, [batch.sources, batch.results, batch.failures, t]);

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
      setSaveError(errorKeyFor(error));
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
        <Text variant="h2">{t('batch.nothingToConvert')}</Text>
        <Button
          label={t('common.back')}
          variant="secondary"
          onPress={onDone}
          style={{ marginTop: theme.space['2xl'] }}
        />
      </Screen>
    );
  }

  const targetLabel = FORMATS[task.targetFormat].label;
  const { progress } = batch;

  return (
    <Screen>
      <Text variant="h1">{t(`tasks.${task.id}.title`)}</Text>
      <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.xs }}>
        {t('batch.summary', { count: progress.totalCount, format: targetLabel })}
      </Text>

      <Card style={{ marginTop: theme.space.xl }}>
        <ProgressBar
          fraction={progress.fraction}
          accessibilityLabel={
            running
              ? t('batch.converting', {
                  done: formatNumber(progress.completedCount),
                  total: formatNumber(progress.totalCount),
                })
              : t('batch.finished', {
                  done: formatNumber(progress.completedCount),
                  total: formatNumber(progress.totalCount),
                })
          }
        />

        <View style={{ marginTop: theme.space.md, flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="mono" color="textSecondary">
            {t('batch.progressCount', {
              done: formatNumber(progress.completedCount + progress.failedCount),
              total: formatNumber(progress.totalCount),
            })}
          </Text>
          <Text variant="mono" color={progress.failedCount > 0 ? 'dangerInk' : 'textTertiary'}>
            {progress.failedCount > 0
              ? t('batch.failedCount', { count: progress.failedCount })
              : formatPercent(progress.fraction)}
          </Text>
        </View>

        {running && progress.currentDisplayName ? (
          <Text
            variant="caption"
            color="textTertiary"
            numberOfLines={1}
            // Android speaks changes to a live region without needing focus. This is the
            // line that says which file is being worked on, which is the only readout a
            // user who cannot see the bar has while it runs.
            accessibilityLiveRegion="polite"
            style={{ marginTop: theme.space.sm }}
          >
            {batch.status === 'cancelling' ? t('batch.finishingCurrent') : progress.currentDisplayName}
          </Text>
        ) : null}
      </Card>

      {batch.status === 'cancelled' ? (
        // A batch stopped from the notification comes back to a screen that would
        // otherwise look like a finished one that inexplicably did 40 of 48. Saying
        // what happened, and that the finished files are still here, is the difference
        // between a deliberate stop and an apparent malfunction.
        <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.md }}>
          {t('batch.stopped', { count: batch.results.length })}
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
          {t('batch.notificationsOff')}
        </Text>
      ) : null}

      {finished && batch.results.length > 0 ? (
        <Card style={{ marginTop: theme.space.lg }} elevation="md">
          <SectionLabel color="textTertiary">{t('batch.total')}</SectionLabel>
          <View style={{ marginTop: theme.space.sm }}>
            <StatRow label={t('common.before')} value={formatBytes(totals.before)} />
            <StatRow label={t('common.after')} value={formatBytes(totals.after)} />
            {(() => {
              const change = describeSizeChange(totals.before, totals.after);
              return (
                <StatRow
                  label={t(change.labelKey)}
                  value={change.value}
                  emphasis
                  {...(change.grew ? { valueColor: 'warningInk' as const } : {})}
                />
              );
            })()}
            <StatRow label={t('common.took')} value={formatDuration(totals.elapsed)} />
          </View>
        </Card>
      ) : null}

      {batch.submitErrorKey ? (
        <Card style={{ marginTop: theme.space.lg }}>
          <Text variant="h3" color="dangerInk">
            {t('batch.couldNotStart')}
          </Text>
          <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.xs }}>
            {t(batch.submitErrorKey)}
          </Text>
        </Card>
      ) : null}

      {saveError ? (
        <Card style={{ marginTop: theme.space.lg }}>
          <Text variant="bodySm" color="dangerInk">
            {t(saveError)}
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
            label={batch.status === 'cancelling' ? t('batch.cancelling') : t('common.cancel')}
            variant="secondary"
            busy={batch.status === 'cancelling'}
            onPress={() => void batch.cancel()}
          />
        ) : (
          <>
            {batch.results.length > 0 ? (
              <Button
                testID="save-button"
                label={
                  saved
                    ? t('batch.savedAll', { count: batch.results.length })
                    : t('batch.saveAll', { count: batch.results.length })
                }
                onPress={() => void onSave()}
                disabled={saved}
              />
            ) : null}
            {batch.failures.length > 0 ? (
              <Button
                testID="retry-button"
                label={t('batch.retry', { count: batch.failures.length })}
                variant="secondary"
                onPress={() => void batch.retryFailed()}
              />
            ) : null}
            <Button label={t('common.done')} variant="ghost" onPress={onDone} />
          </>
        )}
      </View>
    </Screen>
  );
}
