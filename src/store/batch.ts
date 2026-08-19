// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { AppState, type NativeEventSubscription } from 'react-native';
import { create } from 'zustand';

import { jobClient, type BackgroundProgressStatus, type JobStatus } from '@/engine/jobClient';
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

/**
 * Below this, a batch is over before the user could plausibly switch away from it, so
 * asking for a notification permission would buy them nothing. Either threshold on its
 * own is enough — a hundred thumbnails and one raw file are both slow, for different
 * reasons.
 */
export const BACKGROUND_PROMPT_MIN_FILES = 5;
export const BACKGROUND_PROMPT_MIN_BYTES = 40 * 1024 * 1024;

/** Whether this batch is worth spending the app's one permission prompt on. */
export const isWorthPromptingFor = (sources: DetectedFile[]): boolean =>
  sources.length >= BACKGROUND_PROMPT_MIN_FILES ||
  sources.reduce((total, source) => total + source.byteSize, 0) >= BACKGROUND_PROMPT_MIN_BYTES;

/**
 * Reads the status, and asks only when asking could change it.
 *
 * The permission is never requested at launch, never requested twice, and never
 * requested for work that will be finished before the user has put the phone down.
 * Whatever the answer, the batch converts in the background either way — on Android
 * through the foreground service, on iOS through `beginBackgroundTask`. What a refusal
 * costs is the progress notification, which is why a refusal is not treated as an error.
 */
async function resolveBackgroundProgress(
  sources: DetectedFile[],
): Promise<BackgroundProgressStatus> {
  const status = await jobClient.backgroundProgressStatus();
  if (status !== 'denied') return status;
  if (!isWorthPromptingFor(sources)) return status;
  return jobClient.requestBackgroundProgress();
}

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
  /** Null until the first batch has asked. Only ever affects what the UI says. */
  backgroundProgress: BackgroundProgressStatus | null;
  /**
   * The rename pattern for the next batch. Held here rather than passed to `start`,
   * because the screen that sets it is not the screen that submits.
   */
  namePattern: string;
  setNamePattern: (pattern: string) => void;

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
  backgroundProgress: null,
  namePattern: '',

  setNamePattern: (namePattern) => set({ namePattern }),

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

    // Deliberately not awaited. The conversion starts now; a permission granted while
    // it is already running is picked up by the next progress update, and one refused
    // costs the batch nothing. Making the user answer a dialog before any work begins
    // would be the one version of this that is actually intrusive.
    //
    // The catch is not optional. This call decides one line of UI copy, and an
    // unawaited promise that rejects becomes an unhandled rejection the user sees on
    // top of a conversion that is working perfectly well. Whatever went wrong here, the
    // right answer is to say the notification will not appear and get on with it.
    void resolveBackgroundProgress(sources)
      .catch(() => 'blocked' as const)
      .then((backgroundProgress) => {
        if (get().jobId === jobId) set({ backgroundProgress });
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
        namePattern: get().namePattern,
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
      backgroundProgress: null,
      // The pattern deliberately survives a reset: it belongs to the settings the user
      // chose, not to the batch that just finished, and clearing it would silently
      // undo a rename between one batch and the next.
    });
  },
}));

/** True while the queue is doing work the user can cancel. */
export const isBatchRunning = (status: BatchState['status']): boolean =>
  status === 'queued' || status === 'running' || status === 'cancelling';

/** True once the queue has stopped, whatever the outcome. */
export const isBatchFinished = (status: BatchState['status']): boolean =>
  status === 'completed' || status === 'cancelled' || status === 'failed';
