// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  Button,
  Card,
  ChipRow,
  FileRow,
  Screen,
  SegmentedControl,
  Slider,
  StatRow,
  Text,
  TextField,
  Toggle,
} from '@/components';
import { pdfClient, type PdfFitMode, type PdfOrientation, type PdfPageSize } from '@/engine/pdfClient';
import { describePageSelection, expandPageRanges } from '@/engine/pdfPages';
import { fileGateway } from '@/native';
import { isPdfBusy, usePdfStore } from '@/store/pdf';
import { useTheme } from '@/theme';
import { describeSizeChange, formatBytes, formatDuration } from '@/utils/format';
import { CONVERSION_TASKS } from '../home/tasks';
import { errorMessageFor } from '../convert/errors';
import {
  DPI_CHIPS,
  FIT_MODE_HINTS,
  FIT_MODE_SEGMENTS,
  N_UP_CHIPS,
  ORIENTATION_SEGMENTS,
  PAGE_SIZE_CHIPS,
  RENDER_FORMAT_SEGMENTS,
  SPLIT_MODE_SEGMENTS,
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
  const theme = useTheme();
  const pdf = usePdfStore();
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [password, setPassword] = useState('');

  const task = useMemo(
    () => CONVERSION_TASKS.find((t) => t.id === route.params.taskId),
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
      setSaveError(errorMessageFor(error));
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
        <Text variant="h2">Nothing to do</Text>
        <Button label="Back" variant="ghost" onPress={goHome} style={{ marginTop: theme.space.lg }} />
      </Screen>
    );
  }

  const selectedPages = expandPageRanges(pageRanges, pageCount);
  const rangeIsEmpty = pageRanges.trim().length > 0 && selectedPages.length === 0;
  const canRun = pdf.status === 'ready' || pdf.status === 'done' || pdf.status === 'failed';

  return (
    <Screen>
      <Text variant="h1">{task.title}</Text>
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
            <Text variant="h3">This PDF is locked</Text>
            <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.xs }}>
              The password is used to open the file and is never saved, sent, or written
              anywhere.
            </Text>
            <View style={{ marginTop: theme.space.lg }}>
              <TextField
                label="Password"
                value={password}
                onChange={setPassword}
                secure
                autoFocus
                onSubmit={() => void pdf.unlock(password)}
                {...(pdf.passwordFailed
                  ? { hint: 'That password did not open it.', hintIsProblem: true }
                  : {})}
              />
            </View>
            <Button
              label="Unlock"
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
            <Text variant="label" color="textTertiary">
              RESULT
            </Text>
            <View style={{ marginTop: theme.space.sm }}>
              {pdf.documents.map((document) => (
                <View key={document.outputUri}>
                  <StatRow label="Pages" value={String(document.pageCount)} />
                  {document.beforeByteSize > 0 ? (
                    <>
                      <StatRow label="Before" value={formatBytes(document.beforeByteSize)} />
                      <StatRow label="After" value={formatBytes(document.byteSize)} />
                      {(() => {
                        const change = describeSizeChange(
                          document.beforeByteSize,
                          document.byteSize,
                        );
                        return (
                          <StatRow
                            label={change.label}
                            value={change.value}
                            emphasis
                            {...(change.grew ? { valueColor: 'warningInk' as const } : {})}
                          />
                        );
                      })()}
                    </>
                  ) : (
                    <StatRow label="Size" value={formatBytes(document.byteSize)} emphasis />
                  )}
                </View>
              ))}
              {pdf.parts.length > 0 ? (
                <StatRow label="Documents" value={String(pdf.parts.length)} emphasis />
              ) : null}
              {pdf.images.length > 0 ? (
                <StatRow label="Images" value={String(pdf.images.length)} emphasis />
              ) : null}
              <StatRow label="Took" value={formatDuration(pdf.elapsedMs)} />
            </View>
          </Card>
        ) : null}

        {pdf.status === 'done' && (pdf.parts.length > 0 || pdf.images.length > 0) ? (
          <View style={{ marginTop: theme.space.lg, marginBottom: theme.space.lg }}>
            {pdf.parts.map((part) => (
              <FileRow
                key={part.outputUri}
                name={part.outputDisplayName}
                detail={`${describeSourcePages(part.sourcePages)} · ${formatBytes(part.byteSize)}`}
                state="done"
              />
            ))}
            {pdf.images.map((image) => (
              <FileRow
                key={image.outputUri}
                name={image.outputDisplayName}
                detail={`${image.pixelWidth}×${image.pixelHeight} · ${formatBytes(image.byteSize)}`}
                state="done"
              />
            ))}
          </View>
        ) : null}

        {canRun && task.pdfOperation === 'compose' ? (
          <>
            <Card>
              <Text variant="label" color="textSecondary">
                PAGE SIZE
              </Text>
              <ChipRow
                chips={PAGE_SIZE_CHIPS}
                value={pageSize}
                onChange={change(setPageSize)}
                accessibilityLabel="Page size"
                testIDPrefix="page-size"
              />
              <Text variant="caption" color="textTertiary" style={{ marginTop: theme.space.sm }}>
                {PAGE_SIZE_CHIPS.find((c) => c.value === pageSize)?.detail ?? ''}
              </Text>
            </Card>

            {pageSize !== 'fit' ? (
              <Card style={{ marginTop: theme.space.lg }}>
                <SegmentedControl<PdfOrientation>
                  label="ORIENTATION"
                  segments={ORIENTATION_SEGMENTS}
                  value={orientation}
                  onChange={change(setOrientation)}
                />
                <View style={{ marginTop: theme.space.lg }}>
                  <SegmentedControl<PdfFitMode>
                    label="FIT"
                    segments={FIT_MODE_SEGMENTS}
                    value={fitMode}
                    onChange={change(setFitMode)}
                  />
                  <Text variant="caption" color="textTertiary" style={{ marginTop: theme.space.sm }}>
                    {FIT_MODE_HINTS[fitMode]}
                  </Text>
                </View>
                <View style={{ marginTop: theme.space.lg }}>
                  <Slider
                    label="Margin"
                    value={marginPoints}
                    min={0}
                    max={108}
                    step={6}
                    // Points are the PDF unit; inches are the one people can picture.
                    valueLabel={`${(marginPoints / 72).toFixed(2)} in`}
                    onChange={change(setMarginPoints)}
                  />
                </View>
              </Card>
            ) : null}

            <Card style={{ marginTop: theme.space.lg }}>
              <Text variant="label" color="textSecondary">
                IMAGES PER PAGE
              </Text>
              <ChipRow
                chips={N_UP_CHIPS}
                value={nUp}
                onChange={change(setNUp)}
                accessibilityLabel="Images per page"
                testIDPrefix="n-up"
              />
            </Card>
          </>
        ) : null}

        {canRun && task.pdfOperation === 'render' ? (
          <>
            <Card>
              <TextField
                label="Pages"
                value={pageRanges}
                onChange={change(setPageRanges)}
                placeholder="All pages"
                keyboardType="numbers-and-punctuation"
                hint={
                  rangeIsEmpty
                    ? 'That range does not match any pages'
                    : describePageSelection(pageRanges, pageCount)
                }
                hintIsProblem={rangeIsEmpty}
                testID="page-ranges"
              />
              <Text variant="caption" color="textTertiary" style={{ marginTop: theme.space.sm }}>
                Leave it empty for every page, or write something like 1-3, 7, 9-
              </Text>
            </Card>

            <Card style={{ marginTop: theme.space.lg }}>
              <Text variant="label" color="textSecondary">
                RESOLUTION
              </Text>
              <ChipRow
                chips={DPI_CHIPS}
                value={renderDpi}
                onChange={change(setRenderDpi)}
                accessibilityLabel="Resolution"
                testIDPrefix="dpi"
              />
              <Text variant="caption" color="textTertiary" style={{ marginTop: theme.space.sm }}>
                {DPI_CHIPS.find((c) => c.value === renderDpi)?.detail ?? ''}
              </Text>
            </Card>

            <Card style={{ marginTop: theme.space.lg }}>
              <SegmentedControl<'jpeg' | 'png'>
                label="FORMAT"
                segments={RENDER_FORMAT_SEGMENTS}
                value={renderFormat}
                onChange={change(setRenderFormat)}
              />
              {renderFormat === 'jpeg' ? (
                <View style={{ marginTop: theme.space.lg }}>
                  <Slider
                    label="Quality"
                    value={renderQuality}
                    min={1}
                    max={100}
                    step={1}
                    valueLabel={String(renderQuality)}
                    onChange={change(setRenderQuality)}
                  />
                </View>
              ) : (
                <Text variant="caption" color="textTertiary" style={{ marginTop: theme.space.sm }}>
                  PNG is lossless, so there is no quality to choose. Larger files, exact pixels.
                </Text>
              )}
            </Card>
          </>
        ) : null}

        {canRun && task.pdfOperation === 'merge' ? (
          <Card>
            <Text variant="label" color="textSecondary">
              ORDER
            </Text>
            <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.sm }}>
              Documents are joined in the order you picked them.
            </Text>
            <View style={{ marginTop: theme.space.md }}>
              {pdf.sources.map((source, index) => (
                <FileRow
                  key={source.uri}
                  name={`${index + 1}. ${source.displayName}`}
                  detail={formatBytes(source.byteSize)}
                  // These are inputs, not outputs, so they are only ever waiting or
                  // finished — a merge that has happened should not still say WAITING.
                  state={pdf.status === 'done' ? 'done' : 'pending'}
                />
              ))}
            </View>
          </Card>
        ) : null}

        {canRun && task.pdfOperation === 'split' ? (
          <Card>
            <SegmentedControl<'ranges' | 'every'>
              label="SPLIT BY"
              segments={SPLIT_MODE_SEGMENTS}
              value={splitMode}
              onChange={change(setSplitMode)}
            />
            {splitMode === 'ranges' ? (
              <View style={{ marginTop: theme.space.lg }}>
                <TextField
                  label="Ranges"
                  value={splitRanges}
                  onChange={change(setSplitRanges)}
                  placeholder="1-3, 4-8"
                  keyboardType="numbers-and-punctuation"
                  hint="Each range becomes its own document"
                  testID="split-ranges"
                />
              </View>
            ) : (
              <View style={{ marginTop: theme.space.lg }}>
                <Slider
                  label="Pages per document"
                  value={everyNPages}
                  min={1}
                  max={Math.max(pageCount, 1)}
                  step={1}
                  valueLabel={String(everyNPages)}
                  onChange={change(setEveryNPages)}
                />
                <Text variant="caption" color="textTertiary" style={{ marginTop: theme.space.sm }}>
                  {pageCount > 0
                    ? `${Math.ceil(pageCount / everyNPages)} documents from ${pageCount} pages`
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
                This flattens text into pictures
              </Text>
              <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.xs }}>
                Every page is redrawn as an image, so the result cannot be selected,
                searched, or read aloud. Neither platform can shrink a PDF without doing
                this. Keep the original if any of that matters.
              </Text>
            </Card>

            <Card style={{ marginTop: theme.space.lg }}>
              <Text variant="label" color="textSecondary">
                RESOLUTION
              </Text>
              <ChipRow
                chips={DPI_CHIPS}
                value={compressDpi}
                onChange={change(setCompressDpi)}
                accessibilityLabel="Resolution"
                testIDPrefix="compress-dpi"
              />
              <View style={{ marginTop: theme.space.lg }}>
                <Slider
                  label="Quality"
                  value={compressQuality}
                  min={1}
                  max={100}
                  step={1}
                  valueLabel={String(compressQuality)}
                  onChange={change(setCompressQuality)}
                />
              </View>
              <Toggle
                label="Grayscale"
                hint="Halves the size of a scanned document at no readable cost"
                value={grayscale}
                onChange={change(setGrayscale)}
              />
            </Card>
          </>
        ) : null}

        {pdf.error && pdf.status === 'failed' ? (
          <Card style={{ marginTop: theme.space.lg }}>
            <Text variant="h3" color="dangerInk">
              Could not finish
            </Text>
            <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.xs }}>
              {pdf.error}
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
      </ScrollView>

      <View style={{ paddingTop: theme.space.md, gap: theme.space.sm }}>
        {pdf.status === 'done' ? (
          <Button
            label={saved ? 'Saved' : saveLabel(pdf.images.length, pdf.parts.length, pdf.documents.length)}
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
        <Button label="Done" variant="ghost" onPress={goHome} />
      </View>
    </Screen>
  );
}

function summary(operation: string | undefined, fileCount: number, pageCount: number): string {
  const files = `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;
  const pages = `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`;

  switch (operation) {
    case 'compose':
      return `${files} → PDF`;
    case 'merge':
      return `${files} → one PDF`;
    default:
      return pageCount > 0 ? pages : files;
  }
}

function actionLabel(operation: string | undefined): string {
  switch (operation) {
    case 'compose':
      return 'Make PDF';
    case 'render':
      return 'Export pages';
    case 'merge':
      return 'Merge';
    case 'split':
      return 'Split';
    case 'compress':
      return 'Compress';
    default:
      return 'Run';
  }
}

function saveLabel(images: number, parts: number, documents: number): string {
  if (images > 0) return `Save ${images} to Photos`;
  const count = parts + documents;
  return `Save ${count} to Files`;
}

/** "pages 4-6" reads better than "part 2" when the user is looking for a chapter. */
function describeSourcePages(pages: number[]): string {
  const first = pages[0];
  const last = pages[pages.length - 1];
  if (first === undefined || last === undefined) return '';
  if (pages.length === 1) return `page ${first}`;
  return `pages ${first}-${last}`;
}
