// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { AppState, type NativeEventSubscription } from 'react-native';
import { create } from 'zustand';

import { jobClient, type JobStatus } from '@/engine/jobClient';
import type { ConversionOptionsInput } from '@/engine/options';
import type { ConversionResult, DetectedFile, FileFailure, JobProgress } from '@/native/types';

/**
 * A mirror of the native queue's state — never the source of it.
 *
 * The queue keeps converting while the JavaScript runtime is suspended, so everything
 * here is a cache that native can invalidate at any moment. That is why `resync`
 * replaces the whole state rather than merging: after a stretch in the background,
 * reconciling event-by-event would mean trusting a stream that had gaps in it.
 */

const emptyProgress = (jobId: string): JobProgress => ({
  jobId,
  completedCount: 0,
  failedCount: 0,
  totalCount: 0,
  fraction: 0,
  currentDisplayName: '',
});

export type BatchState = {
  jobId: string | null;
  /** What the user picked, kept so the UI can show names and before-sizes. */
  sources: DetectedFile[];
  status: JobStatus | 'idle';
  progress: JobProgress;
  results: ConversionResult[];
  failures: FileFailure[];
  /** Set when the job could not be submitted at all, as opposed to a per-file failure. */
  submitError: string | null;

  start: (sources: DetectedFile[], options: ConversionOptionsInput) => Promise<void>;
  cancel: () => Promise<void>;
  retryFailed: () => Promise<void>;
  resync: () => Promise<void>;
  reset: () => void;
};

/** Live subscriptions for the current job. Outside the store: not rendering state. */
let unsubscribeEvents: (() => void) | null = null;
let appStateSubscription: NativeEventSubscription | null = null;

function teardown() {
  unsubscribeEvents?.();
  unsubscribeEvents = null;
  appStateSubscription?.remove();
  appStateSubscription = null;
}

export const useBatchStore = create<BatchState>((set, get) => ({
  jobId: null,
  sources: [],
  status: 'idle',
  progress: emptyProgress(''),
  results: [],
  failures: [],
  submitError: null,

  async start(sources, options) {
    teardown();

    // Generated here so the UI can correlate events before native has replied.
    const jobId = `job-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    set({
      jobId,
      sources,
      status: 'queued',
      progress: { ...emptyProgress(jobId), totalCount: sources.length },
      results: [],
      failures: [],
      submitError: null,
    });

    unsubscribeEvents = jobClient.subscribe({
      onProgress: (progress) => {
        // Ignore anything from a job the user has already moved on from.
        if (get().jobId !== progress.jobId) return;
        set({ progress, status: 'running' });
      },
      onFileComplete: (eventJobId, result) => {
        if (get().jobId !== eventJobId) return;
        set((state) => ({ results: [...state.results, result] }));
      },
      onFileFailed: (eventJobId, failure) => {
        if (get().jobId !== eventJobId) return;
        set((state) => ({ failures: [...state.failures, failure] }));
      },
      onJobComplete: (state) => {
        if (get().jobId !== state.jobId) return;
        // The completion payload is authoritative; per-file events may have been
        // coalesced away, so the accumulated lists are replaced rather than trusted.
        set({
          status: state.status,
          progress: state.progress,
          results: state.results,
          failures: state.failures,
        });
        teardown();
      },
    });

    // Native keeps working while JavaScript is frozen, so the mirror is stale by the
    // time the app comes back. This is the only reliable moment to correct it.
    appStateSubscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void get().resync();
    });

    try {
      await jobClient.submit({
        jobId,
        inputUris: sources.map((source) => source.uri),
        options,
      });
    } catch (error) {
      teardown();
      set({
        status: 'failed',
        submitError: error instanceof Error ? error.message : String(error),
      });
    }
  },

  async cancel() {
    const { jobId } = get();
    if (!jobId) return;

    set({ status: 'cancelling' });
    await jobClient.cancel(jobId);
    // Cancel resolves only once the queue has drained, so this state is trustworthy.
    await get().resync();
    teardown();
  },

  async retryFailed() {
    const { jobId } = get();
    if (!jobId) return;

    set((state) => ({ status: 'running', failures: [], progress: { ...state.progress, failedCount: 0 } }));
    await jobClient.retryFailed(jobId);
  },

  async resync() {
    const { jobId } = get();
    if (!jobId) return;

    const state = await jobClient.getState(jobId);
    if (get().jobId !== jobId) return;

    set({
      status: state.status,
      progress: state.progress,
      results: state.results,
      failures: state.failures,
    });
  },

  reset() {
    const { jobId } = get();
    teardown();
    if (jobId) jobClient.release(jobId);
    set({
      jobId: null,
      sources: [],
      status: 'idle',
      progress: emptyProgress(''),
      results: [],
      failures: [],
      submitError: null,
    });
  },
}));

/** True while the queue is doing work the user can cancel. */
export const isBatchRunning = (status: BatchState['status']): boolean =>
  status === 'queued' || status === 'running' || status === 'cancelling';

/** True once the queue has stopped, whatever the outcome. */
export const isBatchFinished = (status: BatchState['status']): boolean =>
  status === 'completed' || status === 'cancelled' || status === 'failed';
