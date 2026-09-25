// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { AppState, type NativeEventSubscription } from 'react-native';
import { create } from 'zustand';

import { errorKeyFor, type ErrorKey } from '@/features/convert/errors';

import { jobClient, type BackgroundProgressStatus, type JobStatus } from '@/engine/jobClient';
import { discardFiles, holdFiles } from './files';
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
  /** A catalogue key for a batch that would not start. The screen renders it. */
  submitErrorKey: ErrorKey | null;
  /** Null until the first batch has asked. Only ever affects what the UI says. */
  backgroundProgress: BackgroundProgressStatus | null;
  /** Wall-clock bounds of the run; summing per-file times overstated a concurrent batch. */
  startedAt: number;
  finishedAt: number;
  /**
   * The rename pattern for the next batch. Held here rather than passed to `start`,
   * because the screen that sets it is not the screen that submits.
   */
  namePattern: string;
  setNamePattern: (pattern: string) => void;

  /** `namePattern` is passed only by tasks that show the rename field. */
  start: (
    sources: DetectedFile[],
    options: ConversionOptionsInput,
    namePattern?: string,
  ) => Promise<void>;
  cancel: () => Promise<void>;
  retryFailed: () => Promise<void>;
  resync: () => Promise<void>;
  /** Drops the job but keeps the files, so the same selection can run with new settings. */
  restart: () => void;
  reset: () => void;
};

/** Live subscriptions for the current job. Outside the store: not rendering state. */
let unsubscribeEvents: (() => void) | null = null;
let appStateSubscription: NativeEventSubscription | null = null;

/** Per-file outcomes, flushed a few times a second rather than one render per file. */
let pendingResults: ConversionResult[] = [];
let pendingFailures: FileFailure[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL_MS = 250;

function dropPending() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  pendingResults = [];
  pendingFailures = [];
}

function teardown() {
  unsubscribeEvents?.();
  unsubscribeEvents = null;
  appStateSubscription?.remove();
  appStateSubscription = null;
  dropPending();
}

const noJob = () => ({
  jobId: null,
  status: 'idle' as const,
  progress: emptyProgress(''),
  results: [],
  failures: [],
  submitErrorKey: null,
  backgroundProgress: null,
  startedAt: 0,
  finishedAt: 0,
});

/** Lets go of a job the screen has left, and deletes the files nothing holds any more. */
function abandon(jobId: string | null, status: BatchState['status'], uris: string[]) {
  if (!jobId) {
    discardFiles(uris);
    return;
  }
  if (!isBatchRunning(status)) {
    jobClient.release(jobId);
    discardFiles(uris);
    return;
  }
  // Stopped first, or files still converting would land after the rest were deleted.
  void Promise.resolve()
    .then(() => jobClient.cancel(jobId))
    .then(() => jobClient.getState(jobId))
    .then((state) => state.results.map((result) => result.outputUri))
    .catch(() => [] as string[])
    .then((outputs) => {
      jobClient.release(jobId);
      discardFiles([...uris, ...outputs]);
    });
}

export const useBatchStore = create<BatchState>((set, get) => ({
  jobId: null,
  sources: [],
  status: 'idle',
  progress: emptyProgress(''),
  results: [],
  failures: [],
  submitErrorKey: null,
  backgroundProgress: null,
  startedAt: 0,
  finishedAt: 0,
  namePattern: '',

  setNamePattern: (namePattern) => set({ namePattern }),

  async start(sources, options, namePattern = '') {
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
      submitErrorKey: null,
      startedAt: Date.now(),
      finishedAt: 0,
    });

    watch();

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

    try {
      await jobClient.submit({
        jobId,
        inputUris: sources.map((source) => source.uri),
        options,
        namePattern,
      });
    } catch (error) {
      teardown();
      set({
        status: 'failed',
        submitErrorKey: errorKeyFor(error),
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
    // A new batch may have started during the drain; its listeners are not ours to remove.
    if (get().jobId === jobId) teardown();
  },

  async retryFailed() {
    const { jobId } = get();
    if (!jobId) return;

    set((state) => ({
      status: 'running',
      failures: [],
      progress: { ...state.progress, failedCount: 0 },
      startedAt: Date.now(),
      finishedAt: 0,
    }));
    watch();
    await jobClient.retryFailed(jobId);
  },

  async resync() {
    const { jobId } = get();
    if (!jobId) return;

    const state = await jobClient.getState(jobId);
    if (get().jobId !== jobId) return;
    // The snapshot already holds anything still waiting to be flushed.
    dropPending();

    set({
      status: state.status,
      progress: state.progress,
      results: state.results,
      failures: state.failures,
      ...(isBatchFinished(state.status) && !get().finishedAt ? { finishedAt: Date.now() } : {}),
    });
  },

  restart() {
    const { jobId, status, results } = get();
    teardown();
    set(noJob());
    abandon(
      jobId,
      status,
      results.map((result) => result.outputUri),
    );
  },

  reset() {
    const { jobId, status, sources, results } = get();
    teardown();
    // The rename pattern survives: it belongs to the settings the user chose, not to
    // the batch that just finished.
    set({ ...noJob(), sources: [] });
    abandon(jobId, status, [
      ...sources.map((source) => source.uri),
      ...results.map((result) => result.outputUri),
    ]);
  },
}));

holdFiles(() => {
  const { sources, results } = useBatchStore.getState();
  return [...sources.map((source) => source.uri), ...results.map((result) => result.outputUri)];
});

/** Listens to the current job. A retry calls it again, since completion stops listening. */
function watch() {
  teardown();
  const { getState: get, setState: set } = useBatchStore;

  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const results = pendingResults;
      const failures = pendingFailures;
      pendingResults = [];
      pendingFailures = [];
      set((state) => ({
        ...(results.length > 0 ? { results: [...state.results, ...results] } : {}),
        ...(failures.length > 0 ? { failures: [...state.failures, ...failures] } : {}),
      }));
    }, FLUSH_INTERVAL_MS);
  };

  unsubscribeEvents = jobClient.subscribe({
    onProgress: (progress) => {
      // Ignore anything from a job the user has already moved on from.
      if (get().jobId !== progress.jobId) return;
      set({ progress, status: 'running' });
    },
    onFileComplete: (eventJobId, result) => {
      if (get().jobId !== eventJobId) return;
      pendingResults.push(result);
      scheduleFlush();
    },
    onFileFailed: (eventJobId, failure) => {
      if (get().jobId !== eventJobId) return;
      pendingFailures.push(failure);
      scheduleFlush();
    },
    onJobComplete: (state) => {
      if (get().jobId !== state.jobId) return;
      dropPending();
      // The completion payload is authoritative; per-file events may have been
      // coalesced away, so the accumulated lists are replaced rather than trusted.
      set({
        status: state.status,
        progress: state.progress,
        results: state.results,
        failures: state.failures,
        finishedAt: get().finishedAt || Date.now(),
      });
      teardown();
    },
  });

  // Native keeps working while JavaScript is frozen, so the mirror is stale by the
  // time the app comes back. This is the only reliable moment to correct it.
  appStateSubscription = AppState.addEventListener('change', (next) => {
    if (next === 'active') void get().resync();
  });
}

/** True while the queue is doing work the user can cancel. */
export const isBatchRunning = (status: BatchState['status']): boolean =>
  status === 'queued' || status === 'running' || status === 'cancelling';

/** True once the queue has stopped, whatever the outcome. */
export const isBatchFinished = (status: BatchState['status']): boolean =>
  status === 'completed' || status === 'cancelled' || status === 'failed';
