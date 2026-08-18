// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
import type { UnsafeObject } from 'react-native/Libraries/Types/CodegenTypes';

/**
 * Single-file decode, transform and encode.
 *
 * Batches do not go through here — `NativeJobQueue` calls the same underlying Swift
 * and Kotlin classes directly, so a 500-file job makes one bridge call rather than
 * five hundred. This module serves previews, size estimation, and the single-file
 * path the share extension does not need.
 *
 * `options` is typed as `UnsafeObject` because codegen cannot express a nested
 * structure of this depth. The typed wrapper in `src/native/index.ts` validates it
 * with zod before it crosses, so the boundary is checked — just not by codegen.
 */
export type ConversionResultSpec = {
  /** -1 for a single-file conversion; the job queue overwrites it for a batch. */
  sourceIndex: number;
  outputUri: string;
  outputDisplayName: string;
  format: string;
  byteSize: number;
  pixelWidth: number;
  pixelHeight: number;
  qualityUsed: number;
  elapsedMs: number;
};

export interface Spec extends TurboModule {
  /**
   * Converts one file. Writes to a temporary path and moves it into place atomically,
   * so a process death mid-write cannot leave a half-written file at `outputUri`.
   *
   * An empty `outputUri` means "choose a path in the managed output directory" — the
   * filesystem stays entirely native, and the chosen path comes back in the result.
   */
  convert(inputUri: string, outputUri: string, options: UnsafeObject): Promise<ConversionResultSpec>;

  /**
   * Encodes at the requested settings and reports the byte count without keeping the
   * result. Backs the live "estimated output size" readout next to the quality slider.
   */
  estimateByteSize(inputUri: string, options: UnsafeObject): Promise<number>;

  /**
   * Decodes a downscaled preview no larger than `maxPixelSize` on its long edge and
   * returns a file URI for it. Downsampling happens at decode time, so a 200-megapixel
   * source never becomes a 200-megapixel allocation.
   */
  makePreview(inputUri: string, maxPixelSize: number): Promise<string>;

  /** Cancels in-flight work started by this module. */
  cancelAll(): void;
}

// `get` rather than `getEnforcing`: importing a spec must not throw in Jest or on a
// build where this module is not yet linked. The wrapper in `index.ts` raises a
// specific, actionable error at call time instead.
export default TurboModuleRegistry.get<Spec>('NativeRasterCodec');
