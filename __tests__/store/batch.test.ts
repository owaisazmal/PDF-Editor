// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The batch store's side of the queue: per-file events arriving in bulk, and a retry
 * that has to be heard finishing.
 */

import { useBatchStore } from '@/store/batch';
import type { FileFailure, JobState } from '@/native/types';
import { conversionResult, detectedFile } from '../support/fixtures';

type Handlers = {
  onProgress?: (progress: unknown) => void;
  onFileComplete?: (jobId: string, result: unknown) => void;
  onFileFailed?: (jobId: string, failure: unknown) => void;
  onJobComplete?: (state: JobState) => void;
};

let mockHandlers: Handlers[] = [];

jest.mock('@/engine/jobClient', () => ({
  jobClient: {
    subscribe: jest.fn((handlers: Handlers) => {
      mockHandlers.push(handlers);
      return () => {
        mockHandlers = mockHandlers.filter((entry) => entry !== handlers);
      };
    }),
    submit: jest.fn().mockResolvedValue(undefined),
    retryFailed: jest.fn().mockResolvedValue(undefined),
    cancel: jest.fn().mockResolvedValue(undefined),
    getState: jest.fn(),
    release: jest.fn(),
    backgroundProgressStatus: jest.fn().mockResolvedValue('granted'),
    requestBackgroundProgress: jest.fn().mockResolvedValue('granted'),
  },
}));

const sources = [detectedFile('heic'), detectedFile('heic'), detectedFile('heic')];

const failure = (sourceIndex: number): FileFailure => ({
  sourceIndex,
  uri: `file:///tmp/${sourceIndex}.heic`,
  displayName: `${sourceIndex}.heic`,
  code: 'corrupt',
  message: 'Corrupt.',
});

const finished = (jobId: string, over: Partial<JobState> = {}): JobState => ({
  jobId,
  status: 'completed',
  progress: {
    jobId,
    completedCount: 2,
    failedCount: 1,
    totalCount: 3,
    fraction: 1,
    currentDisplayName: '',
  },
  results: [conversionResult({ sourceIndex: 0 }), conversionResult({ sourceIndex: 1 })],
  failures: [failure(2)],
  ...over,
});

const emit = <K extends keyof Handlers>(name: K, ...args: Parameters<NonNullable<Handlers[K]>>) => {
  for (const handlers of mockHandlers) (handlers[name] as (...values: unknown[]) => void)?.(...args);
};

beforeEach(() => {
  jest.useFakeTimers();
  mockHandlers = [];
  useBatchStore.getState().reset();
});

afterEach(() => {
  useBatchStore.getState().reset();
  jest.useRealTimers();
});

it('applies per-file results in batches rather than one render per file', async () => {
  await useBatchStore.getState().start(sources, { targetFormat: 'jpeg' });
  const { jobId } = useBatchStore.getState();

  emit('onFileComplete', jobId!, conversionResult({ sourceIndex: 0 }));
  emit('onFileComplete', jobId!, conversionResult({ sourceIndex: 1 }));
  emit('onFileFailed', jobId!, failure(2));
  expect(useBatchStore.getState().results).toHaveLength(0);

  jest.advanceTimersByTime(300);
  expect(useBatchStore.getState().results.map((result) => result.sourceIndex)).toEqual([0, 1]);
  expect(useBatchStore.getState().failures.map((entry) => entry.sourceIndex)).toEqual([2]);
});

it('does not add buffered results on top of the authoritative completion', async () => {
  await useBatchStore.getState().start(sources, { targetFormat: 'jpeg' });
  const { jobId } = useBatchStore.getState();

  emit('onFileComplete', jobId!, conversionResult({ sourceIndex: 0 }));
  emit('onJobComplete', finished(jobId!));
  jest.advanceTimersByTime(300);

  expect(useBatchStore.getState().results).toHaveLength(2);
  expect(useBatchStore.getState().status).toBe('completed');
});

it('hears a retried batch finish, after the first completion stopped listening', async () => {
  await useBatchStore.getState().start(sources, { targetFormat: 'jpeg' });
  const { jobId } = useBatchStore.getState();
  emit('onJobComplete', finished(jobId!));
  expect(mockHandlers).toHaveLength(0);

  await useBatchStore.getState().retryFailed();
  expect(useBatchStore.getState().status).toBe('running');

  emit('onJobComplete', finished(jobId!, { failures: [], results: [
    conversionResult({ sourceIndex: 0 }),
    conversionResult({ sourceIndex: 1 }),
    conversionResult({ sourceIndex: 2 }),
  ] }));

  expect(useBatchStore.getState().status).toBe('completed');
  expect(useBatchStore.getState().results).toHaveLength(3);
  expect(useBatchStore.getState().failures).toHaveLength(0);
});

it('times the run by the clock, not by adding up files converted side by side', async () => {
  jest.setSystemTime(new Date('2026-09-23T10:00:00Z'));
  await useBatchStore.getState().start(sources, { targetFormat: 'jpeg' });
  const { jobId } = useBatchStore.getState();

  jest.setSystemTime(new Date('2026-09-23T10:00:07Z'));
  emit('onJobComplete', finished(jobId!));

  const { startedAt, finishedAt } = useBatchStore.getState();
  expect(finishedAt - startedAt).toBe(7000);
});
