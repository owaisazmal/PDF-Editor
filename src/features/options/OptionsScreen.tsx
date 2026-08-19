// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { FORMATS } from '@/engine/formats';
import { isLossy, needsBackgroundChoice, type MetadataMode } from '@/engine/options';
import { RESIZE_PRESETS, matchPreset } from '@/engine/presets';
import {
  Button,
  Card,
  ChipRow,
  Screen,
  SectionLabel,
  SegmentedControl,
  Slider,
  Text,
  TextField,
  Toggle,
} from '@/components';
import { rasterCodec } from '@/native';
import { useBatchStore } from '@/store/batch';
import { useConversionStore } from '@/store/conversion';
import { useOptionsStore } from '@/store/options';
import { usePresetsStore } from '@/store/presets';
import { appendToken, collides, NAME_TOKENS, previewNames } from '@/engine/naming';
import { useTheme } from '@/theme';
import { imageDefaults } from '@/theme/tokens';
import { formatBytes, formatList, formatNumber } from '@/utils/format';
import { CONVERSION_TASKS } from '../home/tasks';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Options'>;

/** Long enough that a drag does not queue an encode per frame. */
const ESTIMATE_DEBOUNCE_MS = 400;

export function OptionsScreen({ route, navigation }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { options, patch, replace } = useOptionsStore();
  const conversionSource = useConversionStore((s) => s.source);
  const batchSources = useBatchStore((s) => s.sources);
  const namePattern = useBatchStore((s) => s.namePattern);
  const setNamePattern = useBatchStore((s) => s.setNamePattern);

  const presets = usePresetsStore((s) => s.presets);
  const savePreset = usePresetsStore((s) => s.save);
  const [presetName, setPresetName] = useState('');
  const [namingPreset, setNamingPreset] = useState(false);

  const task = useMemo(
    () => CONVERSION_TASKS.find((entry) => entry.id === route.params.taskId),
    [route.params.taskId],
  );

  /** The file the estimate is measured against — the first, for a batch. */
  const sample = conversionSource ?? batchSources[0] ?? null;
  const fileCount = conversionSource ? 1 : batchSources.length;

  const [estimate, setEstimate] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const estimateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const estimateToken = useRef(0);

  /**
   * The live size readout.
   *
   * Genuinely re-encodes the sample to measure it, because a formula that guesses from
   * quality and dimensions is wrong by enough to be misleading — which is worse than no
   * number at all when the whole point is hitting a size limit. That makes it far too
   * expensive to run per frame, hence the debounce and the token that discards results
   * from settings the user has already moved past.
   */
  const scheduleEstimate = useCallback(() => {
    if (!sample) return;
    if (estimateTimer.current) clearTimeout(estimateTimer.current);

    estimateTimer.current = setTimeout(() => {
      const token = ++estimateToken.current;
      setEstimating(true);
      void rasterCodec
        .estimateByteSize(sample.uri, useOptionsStore.getState().options)
        .then((bytes) => {
          if (token !== estimateToken.current) return;
          setEstimate(bytes);
        })
        .catch(() => {
          if (token !== estimateToken.current) return;
          // A failed estimate is not a failed conversion; show nothing rather than an
          // error the user cannot act on.
          setEstimate(null);
        })
        .finally(() => {
          if (token === estimateToken.current) setEstimating(false);
        });
    }, ESTIMATE_DEBOUNCE_MS);
  }, [sample]);

  useEffect(() => {
    scheduleEstimate();
    return () => {
      if (estimateTimer.current) clearTimeout(estimateTimer.current);
    };
  }, [scheduleEstimate]);

  /**
   * What the first few files will actually be called.
   *
   * Computed from the same reference the native renamer mirrors, so the preview is a
   * promise rather than an illustration.
   */
  const namePreview = useMemo(() => {
    // Above the early return that narrows `task`, so the format is read defensively.
    const format = task?.targetFormat;
    if (!format || namePattern.trim().length === 0) return [];
    return previewNames(
      namePattern,
      batchSources.map((source) => source.displayName),
      format,
      new Date(),
    );
  }, [namePattern, batchSources, task]);

  const onSavePreset = useCallback(() => {
    if (savePreset(presetName, options) === null) return;
    setPresetName('');
    setNamingPreset(false);
  }, [savePreset, presetName, options]);

  const onConvert = useCallback(() => {
    navigation.navigate(fileCount > 1 ? 'Batch' : 'Convert', { taskId: route.params.taskId });
  }, [navigation, fileCount, route.params.taskId]);

  if (!task || !sample) {
    return (
      <Screen>
        <Text variant="h2">{t('convert.nothingSelected')}</Text>
        <Button
          label={t('common.back')}
          variant="secondary"
          onPress={() => navigation.popTo('Home')}
          style={{ marginTop: theme.space['2xl'] }}
        />
      </Screen>
    );
  }

  const targetFormat = task.targetFormat;
  const targetSpec = FORMATS[targetFormat];
  const lossy = isLossy(targetFormat);
  const willFlatten = needsBackgroundChoice(sample.hasAlpha, targetFormat);
  const targetSizeMode = (options.targetByteSize ?? 0) > 0;
  const activePreset = matchPreset(options);
  const metadataMode = (options.metadata?.mode ?? 'keepExceptGps') as MetadataMode;
  const estimateSize = estimate === null ? '—' : formatBytes(estimate);

  return (
    // `Screen` rather than a bare ScrollView: it owns the safe-area insets, and without
    // it this heading renders underneath the status bar.
    <Screen scroll>
      <Text variant="h1">{t('options.title')}</Text>
      <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.xs }}>
        {t('options.summary', { count: fileCount, format: targetSpec.label })}
      </Text>

      {/* Estimate first: it is the number every other control on this screen moves. */}
      <Card style={{ marginTop: theme.space.xl }} elevation="md">
        <SectionLabel color="textTertiary">{t('options.estimatedOutput')}</SectionLabel>
        <Text variant="monoLg" color="accentInk" style={{ marginTop: theme.space.xs }}>
          {fileCount > 1 ? t('options.each', { size: estimateSize }) : estimateSize}
        </Text>
        <Text variant="caption" color="textTertiary" style={{ marginTop: theme.space.xs }}>
          {estimating
            ? t('options.measuring')
            : fileCount > 1
              ? t('options.measuredOn', { name: sample.displayName })
              : t('options.measured')}
        </Text>
      </Card>

      {lossy ? (
        <Card style={{ marginTop: theme.space.lg }}>
          <Toggle
            label={t('options.aimForSize')}
            hint={t('options.aimForSizeHint')}
            value={targetSizeMode}
            testID="target-size-toggle"
            onChange={(on) => {
              patch({ targetByteSize: on ? 500_000 : 0 });
              scheduleEstimate();
            }}
          />

          {targetSizeMode ? (
            <Slider
              testID="target-size-slider"
              label={t('options.maximumSize')}
              value={Math.round((options.targetByteSize ?? 500_000) / 50_000)}
              min={1}
              max={40}
              step={1}
              valueLabel={formatBytes((options.targetByteSize ?? 500_000))}
              onChange={(steps) => patch({ targetByteSize: steps * 50_000 })}
              onCommit={scheduleEstimate}
              style={{ marginTop: theme.space.sm }}
            />
          ) : (
            <Slider
              testID="quality-slider"
              label={t('options.quality')}
              value={options.quality ?? 82}
              min={1}
              max={100}
              step={1}
              valueLabel={formatNumber(options.quality ?? 82)}
              onChange={(quality) => patch({ quality })}
              onCommit={scheduleEstimate}
              style={{ marginTop: theme.space.sm }}
            />
          )}
        </Card>
      ) : null}

      <Card style={{ marginTop: theme.space.lg }}>
        <SectionLabel>{t('options.size')}</SectionLabel>
        <View style={styles.presets}>
          {RESIZE_PRESETS.map((preset) => {
            const selected = activePreset === preset.id;
            const label = t(`options.resizePresets.${preset.id}.label`);
            return (
              <Pressable
                key={preset.id}
                testID={`preset-${preset.id}`}
                accessibilityRole="button"
                accessibilityLabel={t('a11y.labelledDetail', {
                  label,
                  detail: t(`options.resizePresets.${preset.id}.detail`),
                })}
                accessibilityState={{ selected }}
                onPress={() => {
                  replace(preset.apply(options));
                  scheduleEstimate();
                }}
                style={({ pressed }) => [
                  styles.preset,
                  {
                    backgroundColor: selected ? theme.color.accentDeep : theme.color.bgSunken,
                    borderRadius: theme.radius.pill,
                    borderWidth: StyleSheet.hairlineWidth * 2,
                    borderColor: selected ? theme.color.accentDeep : theme.color.borderHairline,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <Text variant="label" color={selected ? 'textOnAccentDeep' : 'textSecondary'}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text variant="caption" color="textTertiary" style={{ marginTop: theme.space.sm }}>
          {activePreset
            ? t(`options.resizePresets.${activePreset}.detail`)
            : t('options.customSize')}
        </Text>
      </Card>

      <Card style={{ marginTop: theme.space.lg }}>
        <SegmentedControl<'0' | '90' | '180' | '270'>
          label={t('options.rotate')}
          testID="rotate"
          segments={[
            { value: '0', label: t('options.rotateNone') },
            { value: '90', label: '90°', accessibilityLabel: t('options.rotateDegrees', { degrees: 90 }) },
            { value: '180', label: '180°', accessibilityLabel: t('options.rotateDegrees', { degrees: 180 }) },
            { value: '270', label: '270°', accessibilityLabel: t('options.rotateDegrees', { degrees: 270 }) },
          ]}
          value={String(options.rotate ?? 0) as '0' | '90' | '180' | '270'}
          onChange={(value) => patch({ rotate: Number(value) as 0 | 90 | 180 | 270 })}
        />

        <View style={{ marginTop: theme.space.sm }}>
          <Toggle
            label={t('options.flipHorizontally')}
            value={options.flipHorizontal ?? false}
            onChange={(flipHorizontal) => patch({ flipHorizontal })}
          />
          <Toggle
            label={t('options.flipVertically')}
            value={options.flipVertical ?? false}
            onChange={(flipVertical) => patch({ flipVertical })}
          />
        </View>
      </Card>

      <Card style={{ marginTop: theme.space.lg }}>
        <SegmentedControl<MetadataMode>
          label={t('options.metadata')}
          testID="metadata"
          segments={[
            { value: 'keepExceptGps', label: t('options.metadataNoLocation'), accessibilityLabel: t('options.metadataNoLocationLabel') },
            { value: 'keepAll', label: t('options.metadataKeepAll') },
            { value: 'stripAll', label: t('options.metadataStripAll') },
          ]}
          value={metadataMode}
          onChange={(mode) => patch({ metadata: { mode } })}
        />
        <Text variant="caption" color="textTertiary" style={{ marginTop: theme.space.sm }}>
          {t(`options.metadataHint.${metadataMode}`)}
        </Text>

        <View style={{ marginTop: theme.space.xs }}>
          <Toggle
            label={t('options.convertToSrgb')}
            hint={t('options.convertToSrgbHint')}
            value={options.convertToSrgb ?? true}
            onChange={(convertToSrgb) => patch({ convertToSrgb })}
          />
        </View>
      </Card>

      {willFlatten ? (
        <Card style={{ marginTop: theme.space.lg }}>
          <SectionLabel>{t('options.background')}</SectionLabel>
          <Text variant="caption" color="textTertiary" style={{ marginTop: 2 }}>
            {t('options.backgroundHint', { format: targetSpec.label })}
          </Text>

          <View style={styles.swatches}>
            {imageDefaults.backgroundChoices.map((choice) => {
              const selected = (options.background?.color ?? imageDefaults.backgroundFill) === choice.color;
              return (
                <Pressable
                  key={choice.id}
                  testID={`background-${choice.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={t(`options.backgroundColors.${choice.id}`)}
                  accessibilityState={{ selected }}
                  onPress={() => {
                    patch({ background: { color: choice.color } });
                    scheduleEstimate();
                  }}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: theme.radius.sm,
                    backgroundColor: choice.color,
                    // A white swatch on a light card needs an outline to exist at all,
                    // and the selected one needs to be unmistakable without colour.
                    borderWidth: selected ? 3 : StyleSheet.hairlineWidth * 2,
                    borderColor: selected ? theme.color.borderFocus : theme.color.borderControl,
                  }}
                />
              );
            })}
          </View>
        </Card>
      ) : null}

      {/* Renaming only makes sense across a batch: one file already has the name the
          user chose when they saved it. */}
      {fileCount > 1 ? (
        <Card style={{ marginTop: theme.space.lg }}>
          <SectionLabel>{t('options.rename')}</SectionLabel>
          <View style={{ marginTop: theme.space.md }}>
            <TextField
              label={t('options.pattern')}
              value={namePattern}
              onChange={setNamePattern}
              placeholder={t('options.keepOriginalNames')}
              testID="name-pattern"
              {...(collides(namePattern)
                ? {
                    hint: t('options.wouldCollide'),
                    hintIsProblem: true,
                  }
                : {})}
            />
          </View>

          <ChipRow
            chips={NAME_TOKENS.map((token) => ({
              value: token.token,
              label: t(`options.tokens.${token.id}.label`),
              detail: t(`options.tokens.${token.id}.detail`),
            }))}
            // Nothing is selected: these insert rather than choose. The row is the
            // keyboard for a syntax nobody should have to remember.
            value=""
            onChange={(token) => setNamePattern(appendToken(namePattern, token))}
            accessibilityLabel={t('options.tokens.insert')}
            testIDPrefix="name-token"
          />

          <Text variant="caption" color="textTertiary" style={{ marginTop: theme.space.sm }}>
            {namePreview.length > 0
              ? t(
                  fileCount > namePreview.length
                    ? 'options.namePreviewMore'
                    : 'options.namePreview',
                  { names: formatList(namePreview) },
                )
              : t('options.namesKept')}
          </Text>
        </Card>
      ) : null}

      <Card style={{ marginTop: theme.space.lg }}>
        <SectionLabel>{t('options.presets')}</SectionLabel>

        {presets.length > 0 ? (
          <ChipRow
            chips={presets.map((preset) => ({ value: preset.id, label: preset.name }))}
            value=""
            onChange={(id) => {
              const preset = presets.find((entry) => entry.id === id);
              if (!preset) return;
              // The task decides the format; a preset carries everything else.
              replace({ ...preset.options, targetFormat });
              scheduleEstimate();
            }}
            accessibilityLabel={t('options.applyPreset')}
            testIDPrefix="preset"
          />
        ) : (
          <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.sm }}>
            {t('options.presetsEmpty')}
          </Text>
        )}

        {namingPreset ? (
          <View style={{ marginTop: theme.space.md }}>
            <TextField
              label={t('options.presetName')}
              value={presetName}
              onChange={setPresetName}
              placeholder={t('options.presetNamePlaceholder')}
              autoFocus
              onSubmit={onSavePreset}
              testID="preset-name"
            />
            <Button
              label={t('options.savePreset')}
              onPress={onSavePreset}
              disabled={presetName.trim().length === 0}
              style={{ marginTop: theme.space.md }}
            />
          </View>
        ) : (
          <Button
            label={t('options.saveTheseSettings')}
            variant="ghost"
            onPress={() => setNamingPreset(true)}
            style={{ marginTop: theme.space.md }}
          />
        )}
      </Card>

      <View style={{ marginTop: theme.space['2xl'], gap: theme.space.md }}>
        <Button
          testID="convert-with-options"
          label={t('options.convertTo', { format: targetSpec.label })}
          onPress={onConvert}
        />
        <Button label={t('common.back')} variant="ghost" onPress={() => navigation.goBack()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  preset: { paddingHorizontal: 14, paddingVertical: 10, minHeight: 40, justifyContent: 'center' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
});
