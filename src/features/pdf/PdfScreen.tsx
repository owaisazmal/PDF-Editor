// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  Button,
  Card,
  ChipRow,
  FileRow,
  Screen,
  SectionLabel,
  SegmentedControl,
  Slider,
  StatRow,
  Text,
  TextField,
  Toggle,
  type Chip,
  type Segment,
} from '@/components';
import { pdfClient, type PdfFitMode, type PdfOrientation, type PdfPageSize } from '@/engine/pdfClient';
import { describePageSelection, expandPageRanges, type PageSelection } from '@/engine/pdfPages';
import { fileGateway } from '@/native';
import { isPdfBusy, usePdfStore } from '@/store/pdf';
import { useTheme } from '@/theme';
import {
  describeSizeChange,
  formatBytes,
  formatDecimal,
  formatDuration,
  formatNumber,
} from '@/utils/format';
import { CONVERSION_TASKS } from '../home/tasks';
import { errorKeyFor, type ErrorKey } from '../convert/errors';
import { useAnnouncement } from '@/utils/useAnnouncement';
import {
  DPI_VALUES,
  FIT_MODE_VALUES,
  N_UP_VALUES,
  ORIENTATION_VALUES,
  PAGE_SIZE_VALUES,
  RENDER_FORMAT_VALUES,
  SPLIT_MODE_VALUES,
} from './options';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Pdf'>;

/**
 * Every PDF task, in one screen.
 *
 * They share a shape — pick, choose, run, save — and differ only in the middle section
 * and the call at the end. Five screens would have been five copies of the same
 * lifecycle, and the lifecycle is the part with the sharp edges: an unlock session that
 * has to be released, a result set that comes back as three different shapes, and a
 * password prompt that must not read as an error.
 */
export function PdfScreen({ route, navigation }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const pdf = usePdfStore();
  const [saved, setSaved] = useState(false);
  /** A catalogue key, never a message: the engine's own sentences are English only. */
  const [saveError, setSaveError] = useState<ErrorKey | null>(null);
  const [password, setPassword] = useState('');

  const task = useMemo(
    () => CONVERSION_TASKS.find((entry) => entry.id === route.params.taskId),
    [route.params.taskId],
  );

  // Compose
  const [pageSize, setPageSize] = useState<PdfPageSize>('fit');
  const [orientation, setOrientation] = useState<PdfOrientation>('auto');
  const [fitMode, setFitMode] = useState<PdfFitMode>('fit');
  const [marginPoints, setMarginPoints] = useState(36);
  const [nUp, setNUp] = useState<number>(1);

  // Render
  const [pageRanges, setPageRanges] = useState('');
  const [renderDpi, setRenderDpi] = useState(150);
  const [renderFormat, setRenderFormat] = useState<'jpeg' | 'png'>('jpeg');
  const [renderQuality, setRenderQuality] = useState(90);

  // Split
  const [splitMode, setSplitMode] = useState<'ranges' | 'every'>('ranges');
  const [splitRanges, setSplitRanges] = useState('');
  const [everyNPages, setEveryNPages] = useState(1);

  // Compress
  const [compressDpi, setCompressDpi] = useState(150);
  const [compressQuality, setCompressQuality] = useState(70);
  const [grayscale, setGrayscale] = useState(false);

  const busy = isPdfBusy(pdf.status);
  const pageCount = pdf.info?.pageCount ?? 0;

  /**
   * The option vocabulary wears its words here rather than in `options.ts`.
   *
   * A module evaluated once at import time cannot call `t`, and a label captured at
   * import time would be whatever language the app started in. Rebuilt per language
   * rather than per render because a chip row is rebuilt from these on every keystroke
   * in the field above it.
   */
  const pageSizeChips = useMemo<Chip<PdfPageSize>[]>(
    () =>
      PAGE_SIZE_VALUES.map((value) => ({
        value,
        label: t(`pdf.pageSizes.${value}.label`),
        detail: t(`pdf.pageSizes.${value}.detail`),
      })),
    [t],
  );

  const orientationSegments = useMemo<Segment<PdfOrientation>[]>(
    () => ORIENTATION_VALUES.map((value) => ({ value, label: t(`pdf.orientations.${value}`) })),
    [t],
  );

  const fitModeSegments = useMemo<Segment<PdfFitMode>[]>(
    () => FIT_MODE_VALUES.map((value) => ({ value, label: t(`pdf.fitModes.${value}.label`) })),
    [t],
  );

  const nUpChips = useMemo<Chip<number>[]>(
    () =>
      N_UP_VALUES.map((count) => ({
        value: count,
        label: count === 1 ? t('pdf.nUp.single') : t('pdf.nUp.many', { count }),
      })),
    [t],
  );

  const dpiChips = useMemo<Chip<number>[]>(
    () =>
      DPI_VALUES.map(({ id, dpi }) => ({
        value: dpi,
        label: t(`pdf.dpi.${id}.label`),
        detail: t(`pdf.dpi.${id}.detail`, { dpi: formatNumber(dpi) }),
      })),
    [t],
  );

  const renderFormatSegments = useMemo<Segment<'jpeg' | 'png'>[]>(
    () => RENDER_FORMAT_VALUES.map((value) => ({ value, label: t(`pdf.renderFormats.${value}`) })),
    [t],
  );

  const splitModeSegments = useMemo<Segment<'ranges' | 'every'>[]>(
    () =>
      SPLIT_MODE_VALUES.map((value) => ({
        value,
        label: value === 'ranges' ? t('pdf.splitRanges') : t('pdf.splitEvery'),
      })),
    [t],
  );

  // A merge or an export can run for a while with nothing focused, so the outcome is
  // announced rather than left to be discovered.
  useAnnouncement(
    pdf.status === 'done'
      ? t('pdf.announceFinished')
      : pdf.status === 'failed'
        ? t('pdf.announceFailed')
        : pdf.status === 'locked'
          ? t('pdf.announceLocked')
          : null,
  );

  /**
   * Changing a setting after a run puts the screen back into a state where the action
   * button is the action rather than Save. Without this the options are still there,
   * still tappable, and completely inert — which reads as a broken screen rather than a
   * finished one.
   */
  const settingChanged = useCallback(() => {
    if (usePdfStore.getState().status === 'done') usePdfStore.setState({ status: 'ready' });
  }, []);

  /** Wraps a setter so every option change goes through {@link settingChanged}. */
  const change = useCallback(
    <T,>(setter: (value: T) => void) =>
      (value: T) => {
        setter(value);
        settingChanged();
      },
    [settingChanged],
  );

  const summary = useCallback(
    (operation: string | undefined, fileCount: number, pages: number): string => {
      switch (operation) {
        case 'compose':
          return t('pdf.summary.compose', { count: fileCount });
        case 'merge':
          return t('pdf.summary.merge', { count: fileCount });
        default:
          return pages > 0
            ? t('pdf.summary.pages', { count: pages })
            : t('pdf.summary.files', { count: fileCount });
      }
    },
    [t],
  );

  const actionLabel = useCallback(
    (operation: string | undefined): string => {
      switch (operation) {
        case 'compose':
          return t('pdf.actions.compose');
        case 'render':
          return t('pdf.actions.render');
        case 'merge':
          return t('pdf.actions.merge');
        case 'split':
          return t('pdf.actions.split');
        case 'compress':
          return t('pdf.actions.compress');
        default:
          return t('pdf.actions.run');
      }
    },
    [t],
  );

  const saveLabel = useCallback(
    (images: number, parts: number, documents: number): string =>
      images > 0
        ? t('pdf.saveToPhotos', { count: images })
        : t('pdf.saveToFiles', { count: parts + documents }),
    [t],
  );

  /** "pages 4-6" reads better than "part 2" when the user is looking for a chapter. */
  const describeSourcePages = useCallback(
    (pages: number[]): string => {
      const first = pages[0];
      const last = pages[pages.length - 1];
      if (first === undefined || last === undefined) return '';
      if (pages.length === 1) return t('pdf.singlePage', { first: formatNumber(first) });
      return t('pdf.pageRange', { first: formatNumber(first), last: formatNumber(last) });
    },
    [t],
  );

  const describeSelection = useCallback(
    (selection: PageSelection): string => {
      switch (selection.kind) {
        case 'none':
          return t('pdf.noPages');
        case 'unmatched':
          return t('pdf.rangeMatchesNothing');
        case 'all':
          return t('pdf.allNPages', { count: selection.count });
        case 'subset':
          return t('pdf.pagesSelected', {
            count: selection.count,
            total: formatNumber(selection.total),
          });
      }
    },
    [t],
  );

  /**
   * Inspection runs from here rather than from the picker, so the screen is mounted
   * before a password prompt can be needed — the alternative is a modal appearing over
   * the home grid with no context for what it belongs to.
   */
  useEffect(() => {
    if (pdf.status === 'idle' && pdf.sources.length > 0) void pdf.begin(pdf.sources);
  }, [pdf]);

  const goHome = useCallback(() => {
    pdf.reset();
    navigation.popToTop();
  }, [navigation, pdf]);

  const save = useCallback(async () => {
    const uris = [
      ...pdf.documents.map((d) => d.outputUri),
      ...pdf.parts.map((p) => p.outputUri),
      ...pdf.images.map((i) => i.outputUri),
    ];
    if (uris.length === 0) return;

    setSaveError(null);
    try {
      // Images belong in the photo library; documents do not, and putting a PDF there
      // is how it becomes impossible to find again.
      if (pdf.images.length > 0) {
        await fileGateway.saveToPhotos(pdf.images.map((image) => image.outputUri));
      } else {
        await fileGateway.saveToDownloads(uris);
      }
      setSaved(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setSaveError(errorKeyFor(error));
    }
  }, [pdf.documents, pdf.images, pdf.parts]);

  const run = useCallback(() => {
    if (!task) return;
    const first = pdf.sources[0];
    if (!first) return;

    // Cleared here, not on save: a second run produces new files, and a button that
    // still says "Saved" would be describing the previous ones.
    setSaved(false);
    setSaveError(null);

    void pdf.run(async () => {
      switch (task.pdfOperation) {
        case 'compose': {
          const document = await pdfClient.composeFromImages(
            pdf.sources.map((s) => s.uri),
            '',
            { pageSize, orientation, fitMode, marginPoints, nUp },
          );
          return { documents: [document], elapsedMs: document.elapsedMs };
        }
        case 'render': {
          const { results, elapsedMs } = await pdfClient.renderPages(
            first.uri,
            pdf.sessionHandle,
            { pageRanges, dpi: renderDpi, format: renderFormat, quality: renderQuality },
          );
          return { images: results, elapsedMs };
        }
        case 'merge': {
          const document = await pdfClient.merge(pdf.sources.map((s) => s.uri), '');
          return { documents: [document], elapsedMs: document.elapsedMs };
        }
        case 'split': {
          const { results, elapsedMs } = await pdfClient.split(first.uri, '', {
            ranges: splitMode === 'ranges' ? splitRanges : '',
            everyNPages: splitMode === 'every' ? everyNPages : 1,
          });
          return { parts: results, elapsedMs };
        }
        case 'compress': {
          const document = await pdfClient.compress(first.uri, '', {
            dpi: compressDpi,
            quality: compressQuality,
            grayscale,
          });
          return { documents: [document], elapsedMs: document.elapsedMs };
        }
        default:
          // Unreachable: a task routed here always has an operation. English on purpose —
          // `errorKeyFor` turns anything without a native code into `errors.unknown`, so
          // this reaches the log and never the screen.
          throw new Error('That task has no PDF operation.');
      }
    });
  }, [
    task, pdf, pageSize, orientation, fitMode, marginPoints, nUp,
    pageRanges, renderDpi, renderFormat, renderQuality,
    splitMode, splitRanges, everyNPages,
    compressDpi, compressQuality, grayscale,
  ]);

  if (!task) {
    return (
      <Screen>
        <Text variant="h2">{t('pdf.nothingToDo')}</Text>
        <Button label={t('common.back')} variant="ghost" onPress={goHome} style={{ marginTop: theme.space.lg }} />
      </Screen>
    );
  }

  const selectedPages = expandPageRanges(pageRanges, pageCount);
  const rangeIsEmpty = pageRanges.trim().length > 0 && selectedPages.length === 0;
  const canRun = pdf.status === 'ready' || pdf.status === 'done' || pdf.status === 'failed';

  return (
    <Screen>
      <Text variant="h1">{t(`tasks.${task.id}.title`)}</Text>
      <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.xs }}>
        {summary(task.pdfOperation, pdf.sources.length, pageCount)}
      </Text>

      <ScrollView
        style={{ flex: 1, marginTop: theme.space.lg }}
        contentContainerStyle={{ paddingBottom: theme.space.xl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {pdf.status === 'locked' ? (
          <Card>
            <Text variant="h3">{t('pdf.locked')}</Text>
            <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.xs }}>
              {t('pdf.lockedHint')}
            </Text>
            <View style={{ marginTop: theme.space.lg }}>
              <TextField
                label={t('pdf.password')}
                value={password}
                onChange={setPassword}
                secure
                autoFocus
                onSubmit={() => void pdf.unlock(password)}
                {...(pdf.passwordFailed
                  ? { hint: t('pdf.wrongPassword'), hintIsProblem: true }
                  : {})}
              />
            </View>
            <Button
              label={t('pdf.unlock')}
              onPress={() => void pdf.unlock(password)}
              disabled={password.length === 0}
              busy={busy}
              style={{ marginTop: theme.space.lg }}
            />
          </Card>
        ) : null}

        {/* Above the options, not below them. A run that finishes while the screen is
            scrolled to the top otherwise changes only the button, and the result the
            user asked for sits off-screen under settings they can no longer act on. */}
        {pdf.status === 'done' ? (
          <Card style={{ marginTop: theme.space.lg }} elevation="md">
            <SectionLabel color="textTertiary">{t('pdf.result')}</SectionLabel>
            <View style={{ marginTop: theme.space.sm }}>
              {pdf.documents.map((document) => (
                <View key={document.outputUri}>
                  <StatRow label={t('pdf.pagesLabel')} value={formatNumber(document.pageCount)} />
                  {document.beforeByteSize > 0 ? (
                    <>
                      <StatRow label={t('common.before')} value={formatBytes(document.beforeByteSize)} />
                      <StatRow label={t('common.after')} value={formatBytes(document.byteSize)} />
                      {(() => {
                        const change = describeSizeChange(
                          document.beforeByteSize,
                          document.byteSize,
                        );
                        return (
                          <StatRow
                            label={t(change.labelKey)}
                            value={change.value}
                            emphasis
                            {...(change.grew ? { valueColor: 'warningInk' as const } : {})}
                          />
                        );
                      })()}
                    </>
                  ) : (
                    <StatRow label={t('common.size')} value={formatBytes(document.byteSize)} emphasis />
                  )}
                </View>
              ))}
              {pdf.parts.length > 0 ? (
                <StatRow label={t('pdf.documents')} value={formatNumber(pdf.parts.length)} emphasis />
              ) : null}
              {pdf.images.length > 0 ? (
                <StatRow label={t('pdf.images')} value={formatNumber(pdf.images.length)} emphasis />
              ) : null}
              <StatRow label={t('common.took')} value={formatDuration(pdf.elapsedMs)} />
            </View>
          </Card>
        ) : null}

        {pdf.status === 'done' && (pdf.parts.length > 0 || pdf.images.length > 0) ? (
          <View style={{ marginTop: theme.space.lg, marginBottom: theme.space.lg }}>
            {pdf.parts.map((part) => (
              <FileRow
                key={part.outputUri}
                name={part.outputDisplayName}
                detail={t('pdf.partDetail', {
                  pages: describeSourcePages(part.sourcePages),
                  size: formatBytes(part.byteSize),
                })}
                state="done"
              />
            ))}
            {pdf.images.map((image) => (
              <FileRow
                key={image.outputUri}
                name={image.outputDisplayName}
                detail={t('pdf.imageDetail', {
                  width: formatNumber(image.pixelWidth),
                  height: formatNumber(image.pixelHeight),
                  size: formatBytes(image.byteSize),
                })}
                state="done"
              />
            ))}
          </View>
        ) : null}

        {canRun && task.pdfOperation === 'compose' ? (
          <>
            <Card>
              <SectionLabel>{t('pdf.pageSize')}</SectionLabel>
              <ChipRow
                chips={pageSizeChips}
                value={pageSize}
                onChange={change(setPageSize)}
                accessibilityLabel={t('pdf.pageSize')}
                testIDPrefix="page-size"
              />
              <Text variant="caption" color="textTertiary" style={{ marginTop: theme.space.sm }}>
                {pageSizeChips.find((c) => c.value === pageSize)?.detail ?? ''}
              </Text>
            </Card>

            {pageSize !== 'fit' ? (
              <Card style={{ marginTop: theme.space.lg }}>
                {/* `testID` is pinned rather than derived from the label: the control
                    falls back to the label for it, and a label that changes with the
                    language is a test id that changes with the language. */}
                <SegmentedControl<PdfOrientation>
                  label={t('pdf.orientation')}
                  testID="ORIENTATION"
                  segments={orientationSegments}
                  value={orientation}
                  onChange={change(setOrientation)}
                />
                <View style={{ marginTop: theme.space.lg }}>
                  <SegmentedControl<PdfFitMode>
                    label={t('pdf.fit')}
                    testID="FIT"
                    segments={fitModeSegments}
                    value={fitMode}
                    onChange={change(setFitMode)}
                  />
                  <Text variant="caption" color="textTertiary" style={{ marginTop: theme.space.sm }}>
                    {t(`pdf.fitModes.${fitMode}.hint`)}
                  </Text>
                </View>
                <View style={{ marginTop: theme.space.lg }}>
                  <Slider
                    label={t('pdf.margin')}
                    value={marginPoints}
                    min={0}
                    max={108}
                    step={6}
                    // Points are the PDF unit; inches are the one people can picture.
                    valueLabel={t('pdf.marginInches', { inches: formatDecimal(marginPoints / 72, 2) })}
                    onChange={change(setMarginPoints)}
                  />
                </View>
              </Card>
            ) : null}

            <Card style={{ marginTop: theme.space.lg }}>
              <SectionLabel>{t('pdf.imagesPerPage')}</SectionLabel>
              <ChipRow
                chips={nUpChips}
                value={nUp}
                onChange={change(setNUp)}
                accessibilityLabel={t('pdf.imagesPerPage')}
                testIDPrefix="n-up"
              />
            </Card>
          </>
        ) : null}

        {canRun && task.pdfOperation === 'render' ? (
          <>
            <Card>
              <TextField
                label={t('pdf.pagesLabel')}
                value={pageRanges}
                onChange={change(setPageRanges)}
                placeholder={t('pdf.allPages')}
                keyboardType="numbers-and-punctuation"
                hint={
                  rangeIsEmpty
                    ? t('pdf.rangeMatchesNothing')
                    : describeSelection(describePageSelection(pageRanges, pageCount))
                }
                hintIsProblem={rangeIsEmpty}
                testID="page-ranges"
              />
              <Text variant="caption" color="textTertiary" style={{ marginTop: theme.space.sm }}>
                {t('pdf.pagesHint')}
              </Text>
            </Card>

            <Card style={{ marginTop: theme.space.lg }}>
              <SectionLabel>{t('pdf.resolution')}</SectionLabel>
              <ChipRow
                chips={dpiChips}
                value={renderDpi}
                onChange={change(setRenderDpi)}
                accessibilityLabel={t('pdf.resolution')}
                testIDPrefix="dpi"
              />
              <Text variant="caption" color="textTertiary" style={{ marginTop: theme.space.sm }}>
                {dpiChips.find((c) => c.value === renderDpi)?.detail ?? ''}
              </Text>
            </Card>

            <Card style={{ marginTop: theme.space.lg }}>
              <SegmentedControl<'jpeg' | 'png'>
                label={t('pdf.format')}
                testID="FORMAT"
                segments={renderFormatSegments}
                value={renderFormat}
                onChange={change(setRenderFormat)}
              />
              {renderFormat === 'jpeg' ? (
                <View style={{ marginTop: theme.space.lg }}>
                  <Slider
                    label={t('pdf.quality')}
                    value={renderQuality}
                    min={1}
                    max={100}
                    step={1}
                    valueLabel={formatNumber(renderQuality)}
                    onChange={change(setRenderQuality)}
                  />
                </View>
              ) : (
                <Text variant="caption" color="textTertiary" style={{ marginTop: theme.space.sm }}>
                  {t('pdf.pngLossless')}
                </Text>
              )}
            </Card>
          </>
        ) : null}

        {canRun && task.pdfOperation === 'merge' ? (
          <Card>
            <SectionLabel>{t('pdf.order')}</SectionLabel>
            <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.sm }}>
              {t('pdf.orderHint')}
            </Text>
            {/*
              Buttons rather than a drag handle. Dragging is the gesture people expect, and
              it is also the one that fights the surrounding scroll view, needs a long-press
              to disambiguate, and is close to unusable with a screen reader. Two controls
              per row work by touch, by keyboard and by voice, and a merge is rarely more
              than a handful of documents.
            */}
            <View style={{ marginTop: theme.space.md }}>
              {pdf.sources.map((source, index) => (
                <View key={source.uri} style={styles.orderRow}>
                  <View style={styles.orderFile}>
                    <FileRow
                      name={t('pdf.orderedFile', {
                        index: formatNumber(index + 1),
                        name: source.displayName,
                      })}
                      detail={formatBytes(source.byteSize)}
                      // These are inputs, not outputs, so they are only ever waiting or
                      // finished: a merge that has happened should not still say WAITING.
                      state={pdf.status === 'done' ? 'done' : 'pending'}
                    />
                  </View>
                  <Pressable
                    testID={`move-up-${index}`}
                    accessibilityRole="button"
                    accessibilityLabel={t('pdf.moveUp', { name: source.displayName })}
                    accessibilityState={{ disabled: index === 0 }}
                    disabled={index === 0}
                    onPress={() => {
                      pdf.moveSource(index, index - 1);
                      settingChanged();
                    }}
                    style={({ pressed }) => [
                      styles.orderButton,
                      {
                        borderRadius: theme.radius.sm,
                        backgroundColor: theme.color.bgSunken,
                        opacity: index === 0 ? 0.35 : pressed ? 0.6 : 1,
                      },
                    ]}
                  >
                    <Text variant="mono" color="textSecondary">
                      {'\u2191'}
                    </Text>
                  </Pressable>
                  <Pressable
                    testID={`move-down-${index}`}
                    accessibilityRole="button"
                    accessibilityLabel={t('pdf.moveDown', { name: source.displayName })}
                    accessibilityState={{ disabled: index === pdf.sources.length - 1 }}
                    disabled={index === pdf.sources.length - 1}
                    onPress={() => {
                      pdf.moveSource(index, index + 1);
                      settingChanged();
                    }}
                    style={({ pressed }) => [
                      styles.orderButton,
                      {
                        borderRadius: theme.radius.sm,
                        backgroundColor: theme.color.bgSunken,
                        opacity:
                          index === pdf.sources.length - 1 ? 0.35 : pressed ? 0.6 : 1,
                      },
                    ]}
                  >
                    <Text variant="mono" color="textSecondary">
                      {'\u2193'}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        {canRun && task.pdfOperation === 'split' ? (
          <Card>
            <SegmentedControl<'ranges' | 'every'>
              label={t('pdf.splitBy')}
              testID="SPLIT BY"
              segments={splitModeSegments}
              value={splitMode}
              onChange={change(setSplitMode)}
            />
            {splitMode === 'ranges' ? (
              <View style={{ marginTop: theme.space.lg }}>
                <TextField
                  label={t('pdf.ranges')}
                  value={splitRanges}
                  onChange={change(setSplitRanges)}
                  placeholder={t('pdf.rangesPlaceholder')}
                  keyboardType="numbers-and-punctuation"
                  hint={t('pdf.rangesHint')}
                  testID="split-ranges"
                />
              </View>
            ) : (
              <View style={{ marginTop: theme.space.lg }}>
                <Slider
                  label={t('pdf.pagesPerDocument')}
                  value={everyNPages}
                  min={1}
                  max={Math.max(pageCount, 1)}
                  step={1}
                  valueLabel={formatNumber(everyNPages)}
                  onChange={change(setEveryNPages)}
                />
                <Text variant="caption" color="textTertiary" style={{ marginTop: theme.space.sm }}>
                  {pageCount > 0
                    ? t('pdf.documentsFrom', {
                        count: Math.ceil(pageCount / everyNPages),
                        pages: formatNumber(pageCount),
                      })
                    : ''}
                </Text>
              </View>
            )}
          </Card>
        ) : null}

        {canRun && task.pdfOperation === 'compress' ? (
          <>
            <Card>
              {/* Stated before the button, not after the result. Discovering that text
                  stopped being selectable once the original is gone is the failure this
                  card exists to prevent. */}
              <Text variant="h3" color="warningInk">
                {t('pdf.flattensTitle')}
              </Text>
              <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.xs }}>
                {t('pdf.flattensBody')}
              </Text>
            </Card>

            <Card style={{ marginTop: theme.space.lg }}>
              <SectionLabel>{t('pdf.resolution')}</SectionLabel>
              <ChipRow
                chips={dpiChips}
                value={compressDpi}
                onChange={change(setCompressDpi)}
                accessibilityLabel={t('pdf.resolution')}
                testIDPrefix="compress-dpi"
              />
              <View style={{ marginTop: theme.space.lg }}>
                <Slider
                  label={t('pdf.quality')}
                  value={compressQuality}
                  min={1}
                  max={100}
                  step={1}
                  valueLabel={formatNumber(compressQuality)}
                  onChange={change(setCompressQuality)}
                />
              </View>
              <Toggle
                label={t('pdf.grayscale')}
                hint={t('pdf.grayscaleHint')}
                value={grayscale}
                onChange={change(setGrayscale)}
              />
            </Card>
          </>
        ) : null}

        {pdf.errorKey && pdf.status === 'failed' ? (
          <Card style={{ marginTop: theme.space.lg }}>
            <Text variant="h3" color="dangerInk">
              {t('pdf.couldNotFinish')}
            </Text>
            <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.xs }}>
              {t(pdf.errorKey)}
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
      </ScrollView>

      <View style={{ paddingTop: theme.space.md, gap: theme.space.sm }}>
        {pdf.status === 'done' ? (
          <Button
            // `pdf.savedButton`, not `common.saved`: that one is the bytes a conversion
            // saved, and most languages use a different word for each.
            label={saved ? t('pdf.savedButton') : saveLabel(pdf.images.length, pdf.parts.length, pdf.documents.length)}
            onPress={() => void save()}
            disabled={saved}
          />
        ) : (
          <Button
            label={actionLabel(task.pdfOperation)}
            onPress={run}
            disabled={!canRun || busy || rangeIsEmpty}
            busy={busy}
          />
        )}
        <Button label={t('common.done')} variant="ghost" onPress={goHome} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  orderFile: { flex: 1, minWidth: 0 },
  // A full 44pt target, which the glyph on its own is nowhere near.
  orderButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
