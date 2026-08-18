// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Typed client for the native batch queue.
 *
 * Native owns job state. This module does two things and deliberately no more: it
 * validates what goes out, and it narrows what comes back. It does not keep a copy of
 * the queue's state — `src/store/batch.ts` does that, and treats it as a cache that
 * native can invalidate at any time.
 *
 * The reason for that split is that the app can be suspended mid-batch. Anything this
 * layer remembered while the JavaScript runtime was frozen would be wrong on resume.
 */

import { z } from 'zod';

import { jobQueue } from '@/native';
import { conversionOptionsSchema } from './options';
import type { ConversionResult, FileFailure, JobProgress, JobState } from '@/native/types';

/* ------------------------------------------------------------------ outbound ---- */

export const jobSpecSchema = z.object({
  /** Caller-generated so the UI can correlate before native replies. */
  jobId: z.string().min(1),
  inputUris: z.array(z.string().min(1)).min(1, 'A job needs at least one input file.'),
  options: conversionOptionsSchema,
  /** Empty means the app's managed output directory. */
  outputDirectory: z.string().default(''),
  /** `{name}`, `{index}`, `{date}`, `{format}`. Empty keeps the source name. */
  namePattern: z.string().default(''),
  /** 0 lets native size the queue from the CPU count and the device RAM class. */
  maxConcurrency: z.number().int().min(0).max(16).default(0),
  continueInBackground: z.boolean().default(true),
});

export type JobSpecInput = z.input<typeof jobSpecSchema>;

/* ------------------------------------------------------------------- inbound ---- */

/**
 * Statuses native can report. Anything unrecognised is treated as `failed` rather than
 * passed through, so a future native status cannot leave the UI in a state it has no
 * rendering for.
 */
export const JOB_STATUSES = [
  'queued',
  'running',
  'cancelling',
  'completed',
  'cancelled',
  'failed',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

const isJobStatus = (value: unknown): value is JobStatus =>
  typeof value === 'string' && (JOB_STATUSES as readonly string[]).includes(value);

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

function narrowProgress(raw: unknown): JobProgress {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    jobId: asString(source.jobId),
    completedCount: asNumber(source.completedCount),
    failedCount: asNumber(source.failedCount),
    totalCount: asNumber(source.totalCount),
    // Clamped because a progress bar past 100% is a rendering bug the user sees.
    fraction: Math.min(1, Math.max(0, asNumber(source.fraction))),
    currentDisplayName: asString(source.currentDisplayName),
  };
}

function narrowResult(raw: unknown): ConversionResult {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    outputUri: asString(source.outputUri),
    outputDisplayName: asString(source.outputDisplayName),
    format: asString(source.format),
    byteSize: asNumber(source.byteSize),
    pixelWidth: asNumber(source.pixelWidth),
    pixelHeight: asNumber(source.pixelHeight),
    qualityUsed: asNumber(source.qualityUsed),
    elapsedMs: asNumber(source.elapsedMs),
  };
}

function narrowFailure(raw: unknown): FileFailure {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    uri: asString(source.uri),
    displayName: asString(source.displayName),
    code: asString(source.code, 'unknown'),
    message: asString(source.message),
  };
}

export function narrowJobState(raw: unknown): JobState {
  const source = (raw ?? {}) as Record<string, unknown>;
  const status = source.status;
  return {
    jobId: asString(source.jobId),
    status: isJobStatus(status) ? status : 'failed',
    progress: narrowProgress(source.progress),
    results: Array.isArray(source.results) ? source.results.map(narrowResult) : [],
    failures: Array.isArray(source.failures) ? source.failures.map(narrowFailure) : [],
  };
}

/* -------------------------------------------------------------------- client ---- */

class JobQueueUnavailableError extends Error {
  constructor() {
    super(
      'The native job queue is not linked into this build. Run `npm run prebuild` and ' +
        'rebuild — this app cannot run in Expo Go.',
    );
    this.name = 'JobQueueUnavailableError';
  }
}

const required = () => {
  if (jobQueue == null) throw new JobQueueUnavailableError();
  return jobQueue;
};

export type JobEvents = {
  onProgress: (progress: JobProgress) => void;
  onFileComplete: (jobId: string, result: ConversionResult) => void;
  onFileFailed: (jobId: string, failure: FileFailure) => void;
  onJobComplete: (state: JobState) => void;
};

export const jobClient = {
  /** True when this build can run batches at all. */
  isAvailable: (): boolean => jobQueue != null,

  /**
   * Validates and submits. Resolves as soon as the job is queued, not when it finishes
   * — the outcome arrives through {@link subscribe}.
   */
  async submit(spec: JobSpecInput): Promise<void> {
    const validated = jobSpecSchema.parse(spec);
    await required().submit(validated);
  },

  /** Resolves once the queue has drained, so nothing is still writing to disk. */
  cancel: (jobId: string): Promise<void> => required().cancel(jobId),

  /**
   * The authoritative state. Call this on every foreground transition: native keeps
   * working while the JavaScript runtime is suspended, so any mirror is stale by then.
   */
  async getState(jobId: string): Promise<JobState> {
    return narrowJobState(await required().getState(jobId));
  },

  retryFailed: (jobId: string): Promise<void> => required().retryFailed(jobId),

  release: (jobId: string): void => {
    jobQueue?.release(jobId);
  },

  /** Returns an unsubscribe function. Every listener is optional. */
  subscribe(handlers: Partial<JobEvents>): () => void {
    const native = required();
    const subscriptions = [
      handlers.onProgress &&
        native.onProgress((payload) => handlers.onProgress?.(narrowProgress(payload))),
      handlers.onFileComplete &&
        native.onFileComplete((payload) => {
          const source = (payload ?? {}) as Record<string, unknown>;
          handlers.onFileComplete?.(asString(source.jobId), narrowResult(source.result));
        }),
      handlers.onFileFailed &&
        native.onFileFailed((payload) => {
          const source = (payload ?? {}) as Record<string, unknown>;
          handlers.onFileFailed?.(asString(source.jobId), narrowFailure(source.failure));
        }),
      handlers.onJobComplete &&
        native.onJobComplete((payload) => handlers.onJobComplete?.(narrowJobState(payload))),
    ].filter(Boolean) as { remove: () => void }[];

    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  },
};
