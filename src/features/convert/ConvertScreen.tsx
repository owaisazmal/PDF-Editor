// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button, Card, Screen, StatRow, Text } from '@/components';
import { FORMATS } from '@/engine/formats';
import { needsBackgroundChoice } from '@/engine/options';
import { fileGateway } from '@/native';
import { useConversionStore } from '@/store/conversion';
import { useRecordConversion } from '../history/recording';
import { useTheme } from '@/theme';
import { imageDefaults } from '@/theme/tokens';
import { formatBytes, formatDimensions, formatDuration, percentageSaved } from '@/utils/format';
import { CONVERSION_TASKS } from '../home/tasks';
import { errorMessage } from './errors';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Convert'>;

export function ConvertScreen({ route, navigation }: Props) {
  const theme = useTheme();
  const { phase, source, result, failure, convert, reset } = useConversionStore();
  const [saved, setSaved] = useState(false);

  const task = useMemo(
    () => CONVERSION_TASKS.find((t) => t.id === route.params.taskId),
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
        <Text variant="h2">Nothing selected</Text>
        <Text variant="body" color="textSecondary" style={{ marginTop: theme.space.sm }}>
          Pick a file from the home screen to get started.
        </Text>
        <Button label="Back" variant="secondary" onPress={onStartOver} style={{ marginTop: theme.space['2xl'] }} />
      </Screen>
    );
  }

  const sourceSpec = source.format ? FORMATS[source.format] : null;
  const targetSpec = FORMATS[task.targetFormat];
  const willFlatten = needsBackgroundChoice(source.hasAlpha, task.targetFormat);

  // Negative when the output grew, which happens legitimately — a smooth gradient or
  // flat artwork encodes far smaller in HEVC than in JPEG. The row below reports that
  // as "Larger by 86%" rather than the nonsense "Saved -86%".
  const sizeDelta = result ? percentageSaved(source.byteSize, result.byteSize) : 0;
  const grew = sizeDelta < 0;

  return (
    <Screen scroll>
      <Text variant="h1">{task.title}</Text>

      <Card style={{ marginTop: theme.space['2xl'] }}>
        <Text variant="label" color="textTertiary">
          SELECTED FILE
        </Text>
        <Text variant="h3" numberOfLines={2} style={{ marginTop: theme.space.xs }}>
          {source.displayName}
        </Text>

        <View style={{ marginTop: theme.space.md }}>
          <StatRow label="Format" value={sourceSpec?.label ?? 'Unrecognised'} />
          <StatRow
            label="Dimensions"
            value={formatDimensions(source.pixelWidth, source.pixelHeight)}
          />
          <StatRow label="Size" value={formatBytes(source.byteSize)} />
        </View>

        {source.claimedFormat && source.claimedFormat !== source.format ? (
          <Text variant="bodySm" color="warningInk" style={{ marginTop: theme.space.md }}>
            This file is named as {FORMATS[source.claimedFormat].label} but its contents are{' '}
            {sourceSpec?.label}. Converting the real format.
          </Text>
        ) : null}

        {source.hasGpsMetadata ? (
          <Text variant="bodySm" color="successInk" style={{ marginTop: theme.space.sm }}>
            Location data found. It will be removed from the converted file.
          </Text>
        ) : null}

        {willFlatten ? (
          <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.sm }}>
            {targetSpec.label} has no transparency, so transparent areas become white.
          </Text>
        ) : null}
      </Card>

      {phase === 'done' && result ? (
        <Card style={{ marginTop: theme.space.lg }} elevation="md">
          <Text variant="label" color="textTertiary">
            RESULT
          </Text>
          <View style={{ marginTop: theme.space.md }}>
            <StatRow label="Before" value={formatBytes(source.byteSize)} />
            <StatRow label="After" value={formatBytes(result.byteSize)} />
            <StatRow
              label={grew ? 'Larger by' : 'Saved'}
              value={`${Math.abs(sizeDelta)}%`}
              emphasis
              {...(grew ? { valueColor: 'warningInk' as const } : {})}
              accessibilityLabel={`${Math.abs(sizeDelta)} percent ${grew ? 'larger' : 'smaller'}`}
            />
            <StatRow label="Took" value={formatDuration(result.elapsedMs)} />
          </View>

          {grew ? (
            // Honest rather than flattering. A converter that reports "0% saved" when
            // the file grew looks broken; one that explains why is useful. HEVC beats
            // JPEG badly on smooth gradients and flat artwork, so this is expected and
            // the user has a real choice to make.
            <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.md }}>
              {sourceSpec?.label} compresses this image better than {targetSpec.label} can.
              The conversion is still correct — lower the quality if size matters more
              than fidelity, or keep the original.
            </Text>
          ) : null}
        </Card>
      ) : null}

      {phase === 'error' && failure ? (
        <Card style={{ marginTop: theme.space.lg }}>
          <Text variant="h3" color="dangerInk">
            Could not convert this file
          </Text>
          <Text variant="body" color="textSecondary" style={{ marginTop: theme.space.sm }}>
            {errorMessage(failure.code)}
          </Text>
        </Card>
      ) : null}

      <View style={{ marginTop: theme.space['2xl'], gap: theme.space.md }}>
        {phase === 'done' ? (
          <>
            <Button
              testID="save-button"
              label={saved ? 'Saved to Photos' : 'Save to Photos'}
              onPress={() => void onSave()}
              disabled={saved}
            />
            <Button label="Convert another" variant="secondary" onPress={onStartOver} />
          </>
        ) : (
          <>
            <Button
              testID="convert-button"
              label={`Convert to ${targetSpec.label}`}
              onPress={() => void onConvert()}
              busy={phase === 'converting'}
              disabled={!source.format}
            />
            <Button label="Cancel" variant="ghost" onPress={onStartOver} />
          </>
        )}
      </View>
    </Screen>
  );
}
