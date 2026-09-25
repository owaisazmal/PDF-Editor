// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * What a finished batch writes to history, and what a retry of it adds.
 */

import { renderHook } from '@testing-library/react-native';

import { useRecordConversion } from '@/features/history/recording';
import { CONVERSION_TASKS } from '@/features/home/tasks';
import { useHistoryStore } from '@/store/history';
import type { ConversionResult, DetectedFile } from '@/native/types';
import { conversionResult, detectedFile } from '../support/fixtures';

jest.mock('@/native', () => require('../support/nativeMock').createNativeMock());

const task = CONVERSION_TASKS.find((candidate) => candidate.id === 'compress-image')!;

const sources = [0, 1, 2].map((i) =>
  detectedFile('jpeg', { displayName: `IMG_${i}.jpg`, byteSize: 1_000_000 * (i + 1) }),
);
const output = (i: number) =>
  conversionResult({ sourceIndex: i, outputUri: `file:///out/IMG_${i}.jpg`, byteSize: 100_000 });

type Props = { finished: boolean; results: ConversionResult[]; failed: number };

const mount = (initial: Props) =>
  renderHook(
    ({ finished, results, failed }: Props) =>
      useRecordConversion(task, finished, sources as DetectedFile[], results, failed),
    { initialProps: initial },
  );

beforeEach(() => useHistoryStore.getState().clear());

it('records a finished batch once, however often the screen re-renders', async () => {
  const hook = await mount({ finished: true, results: [output(0), output(1)], failed: 1 });
  await hook.rerender({ finished: true, results: [output(0), output(1)], failed: 1 });

  const entries = useHistoryStore.getState().entries;
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ fileCount: 2, failedCount: 1, bytesBefore: 3_000_000 });
});

it('adds nothing for a retry that converted nothing new', async () => {
  const hook = await mount({ finished: true, results: [output(0), output(1)], failed: 1 });
  await hook.rerender({ finished: false, results: [output(0), output(1)], failed: 0 });
  await hook.rerender({ finished: true, results: [output(0), output(1)], failed: 1 });

  expect(useHistoryStore.getState().entries).toHaveLength(1);
});

it('records only the file a successful retry converted', async () => {
  const hook = await mount({ finished: true, results: [output(0), output(1)], failed: 1 });
  await hook.rerender({ finished: false, results: [output(0), output(1)], failed: 0 });
  await hook.rerender({ finished: true, results: [output(0), output(1), output(2)], failed: 0 });

  const entries = useHistoryStore.getState().entries;
  expect(entries).toHaveLength(2);
  // Newest first: the retry, which converted the third source alone.
  expect(entries[0]).toMatchObject({ fileCount: 1, failedCount: 0, bytesBefore: 3_000_000 });
});

it('records no sizes for work that is not about size', async () => {
  await renderHook(() =>
    useRecordConversion(task, true, sources as DetectedFile[], [output(0)], 0, false),
  );

  expect(useHistoryStore.getState().entries[0]).toMatchObject({
    fileCount: 1,
    bytesBefore: 0,
    bytesAfter: 0,
  });
});
