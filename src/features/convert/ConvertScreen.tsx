// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button, Card, Screen, SectionLabel, StatRow, Text } from '@/components';
import { FORMATS } from '@/engine/formats';
import { needsBackgroundChoice } from '@/engine/options';
import { fileGateway } from '@/native';
import { useConversionStore } from '@/store/conversion';
import { useRecordConversion } from '../history/recording';
import { useAnnouncement } from '@/utils/useAnnouncement';
import { useTheme } from '@/theme';
import { imageDefaults } from '@/theme/tokens';
import {
  describeSizeChange,
  formatBytes,
  formatDimensions,
  formatDuration,
  formatNumber,
  percentageSaved,
} from '@/utils/format';
import { CONVERSION_TASKS } from '../home/tasks';
import { errorKey } from './errors';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Convert'>;

export function ConvertScreen({ route, navigation }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { phase, source, result, failure, convert, reset } = useConversionStore();
  const [saved, setSaved] = useState(false);

  const task = useMemo(
    () => CONVERSION_TASKS.find((candidate) => candidate.id === route.params.taskId),
    [route.params.taskId],
  );

  const onConvert = useCallback(async () => {
    if (!task) return;
    await convert(
      {
        targetFormat: task.targetFormat,
        quality: 82,
        // Transparency only matters when the source has it and the target cannot
        // keep it. This fill is image data, not interface, so it comes from
        // `imageDefaults` and never from the active theme — a file converted in
        // dark mode must not come out with a dark background.
        background: { color: imageDefaults.backgroundFill },
      },
      '',
    );
    const next = useConversionStore.getState();
    await Haptics.notificationAsync(
      next.phase === 'done'
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Error,
    );
  }, [convert, task]);

  const onSave = useCallback(async () => {
    if (!result) return;
    await fileGateway.saveToPhotos([result.outputUri]);
    setSaved(true);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [result]);

  // Spoken on the outcome, because a conversion finishes without anything being tapped
  // and a screen reader would otherwise say nothing at all.
  useAnnouncement(
    phase === 'done'
      ? t('convert.announceDone')
      : phase === 'error'
        ? t('convert.announceFailed')
        : null,
  );

  // Above the early return, because hooks cannot be called conditionally. The hook
  // itself does nothing until there is a finished conversion to record.
  useRecordConversion(
    task,
    phase === 'done',
    source ? [source] : [],
    result ? [result] : [],
    failure ? 1 : 0,
  );

  const onStartOver = useCallback(() => {
    reset();
    setSaved(false);
    navigation.popTo('Home');
  }, [navigation, reset]);

  if (!source || !task) {
    return (
      <Screen>
        <Text variant="h2">{t('convert.nothingSelected')}</Text>
        <Text variant="body" color="textSecondary" style={{ marginTop: theme.space.sm }}>
          {t('convert.pickToStart')}
        </Text>
        <Button label={t('common.back')} variant="secondary" onPress={onStartOver} style={{ marginTop: theme.space['2xl'] }} />
      </Screen>
    );
  }

  const sourceSpec = source.format ? FORMATS[source.format] : null;
  const targetSpec = FORMATS[task.targetFormat];
  const sourceLabel = sourceSpec?.label ?? t('common.unrecognised');
  const willFlatten = needsBackgroundChoice(source.hasAlpha, task.targetFormat);

  // Negative when the output grew, which happens legitimately — a smooth gradient or
  // flat artwork encodes far smaller in HEVC than in JPEG. The row below reports that
  // as "Larger by 86%" rather than the nonsense "Saved -86%".
  const sizeDelta = result ? percentageSaved(source.byteSize, result.byteSize) : 0;
  const change = result ? describeSizeChange(source.byteSize, result.byteSize) : null;

  // Spoken as a sentence rather than as "Larger by: 86%", which is a label and a figure
  // read in sequence and leaves the direction to be worked out. Silent when the change
  // rounded away to nothing, because then the row carries no figure to explain.
  const spokenChange = change?.value
    ? t(change.grew ? 'a11y.percentLarger' : 'a11y.percentSmaller', {
        percent: formatNumber(Math.abs(sizeDelta)),
      })
    : undefined;

  return (
    <Screen scroll>
      <Text variant="h1">{t(`tasks.${task.id}.title`)}</Text>

      <Card style={{ marginTop: theme.space['2xl'] }}>
        <SectionLabel color="textTertiary">{t('convert.selectedFile')}</SectionLabel>
        <Text variant="h3" numberOfLines={2} style={{ marginTop: theme.space.xs }}>
          {source.displayName}
        </Text>

        <View style={{ marginTop: theme.space.md }}>
          <StatRow label={t('convert.format')} value={sourceLabel} />
          <StatRow
            label={t('convert.dimensions')}
            value={formatDimensions(source.pixelWidth, source.pixelHeight)}
          />
          <StatRow label={t('common.size')} value={formatBytes(source.byteSize)} />
        </View>

        {source.claimedFormat && source.claimedFormat !== source.format ? (
          <Text variant="bodySm" color="warningInk" style={{ marginTop: theme.space.md }}>
            {t('convert.claimedMismatch', {
              claimed: FORMATS[source.claimedFormat].label,
              actual: sourceLabel,
            })}
          </Text>
        ) : null}

        {source.hasGpsMetadata ? (
          <Text variant="bodySm" color="successInk" style={{ marginTop: theme.space.sm }}>
            {t('convert.gpsFound')}
          </Text>
        ) : null}

        {willFlatten ? (
          <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.sm }}>
            {t('convert.willFlatten', { format: targetSpec.label })}
          </Text>
        ) : null}
      </Card>

      {phase === 'done' && result && change ? (
        <Card style={{ marginTop: theme.space.lg }} elevation="md">
          <SectionLabel color="textTertiary">{t('convert.result')}</SectionLabel>
          <View style={{ marginTop: theme.space.md }}>
            <StatRow label={t('common.before')} value={formatBytes(source.byteSize)} />
            <StatRow label={t('common.after')} value={formatBytes(result.byteSize)} />
            <StatRow
              label={t(change.labelKey)}
              value={change.value}
              emphasis
              {...(change.grew ? { valueColor: 'warningInk' as const } : {})}
              {...(spokenChange ? { accessibilityLabel: spokenChange } : {})}
            />
            <StatRow label={t('common.took')} value={formatDuration(result.elapsedMs)} />
          </View>

          {change.grew ? (
            // Honest rather than flattering. A converter that reports "0% saved" when
            // the file grew looks broken; one that explains why is useful. HEVC beats
            // JPEG badly on smooth gradients and flat artwork, so this is expected and
            // the user has a real choice to make.
            <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.md }}>
              {t('convert.grewExplanation', { source: sourceLabel, target: targetSpec.label })}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {phase === 'error' && failure ? (
        <Card style={{ marginTop: theme.space.lg }}>
          <Text variant="h3" color="dangerInk">
            {t('convert.failed')}
          </Text>
          <Text variant="body" color="textSecondary" style={{ marginTop: theme.space.sm }}>
            {t(errorKey(failure.code))}
          </Text>
        </Card>
      ) : null}

      <View style={{ marginTop: theme.space['2xl'], gap: theme.space.md }}>
        {phase === 'done' ? (
          <>
            <Button
              testID="save-button"
              label={saved ? t('convert.savedToPhotos') : t('convert.saveToPhotos')}
              onPress={() => void onSave()}
              disabled={saved}
            />
            <Button label={t('convert.convertAnother')} variant="secondary" onPress={onStartOver} />
          </>
        ) : (
          <>
            <Button
              testID="convert-button"
              label={t('convert.convertTo', { format: targetSpec.label })}
              onPress={() => void onConvert()}
              busy={phase === 'converting'}
              disabled={!source.format}
            />
            <Button label={t('common.cancel')} variant="ghost" onPress={onStartOver} />
          </>
        )}
      </View>
    </Screen>
  );
}
