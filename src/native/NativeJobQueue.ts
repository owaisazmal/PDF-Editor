// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
import type { EventEmitter, UnsafeObject } from 'react-native/Libraries/Types/CodegenTypes';

/**
 * The batch executor. This is the spine of the app.
 *
 * JavaScript submits one declarative job and then only observes. It does not loop over
 * files, hold buffers, or schedule work. That is what makes four things possible at
 * once: converting while backgrounded (iOS suspends the JS runtime, so a JS-driven
 * loop would stall), a share extension that runs no JavaScript at all, cancellation
 * that aborts work already in flight, and a memory ceiling enforced where the
 * allocations actually happen.
 *
 * Progress events are coalesced natively to roughly 10 Hz. Emitting per-file events at
 * full speed for a 500-file batch floods the JS thread and is the usual cause of
 * stuttering progress bars in this category of app.
 */
export interface Spec extends TurboModule {
  /**
   * Queues a job and returns immediately. Concurrency is chosen from the CPU count and
   * the device RAM class unless the spec overrides it.
   */
  submit(spec: UnsafeObject): Promise<void>;

  /**
   * Requests cancellation. In-flight files stop at their next checkpoint and any
   * partial output is deleted. Resolves once the queue has drained.
   */
  cancel(jobId: string): Promise<void>;

  /**
   * The authoritative job state. JavaScript mirrors this in its store, but native owns
   * it — after a background stretch the mirror is stale and is replaced wholesale from
   * here on the next foreground transition.
   */
  getState(jobId: string): Promise<UnsafeObject>;

  /** Re-runs only the files that failed, keeping the original settings. */
  retryFailed(jobId: string): Promise<void>;

  /** Drops a finished job's bookkeeping. Does not touch output files. */
  release(jobId: string): void;

  readonly onProgress: EventEmitter<UnsafeObject>;
  readonly onFileComplete: EventEmitter<UnsafeObject>;
  readonly onFileFailed: EventEmitter<UnsafeObject>;
  readonly onJobComplete: EventEmitter<UnsafeObject>;
}

// `get` rather than `getEnforcing`: importing a spec must not throw in Jest or on a
// build where this module is not yet linked. The wrapper in `index.ts` raises a
// specific, actionable error at call time instead.
export default TurboModuleRegistry.get<Spec>('NativeJobQueue');
