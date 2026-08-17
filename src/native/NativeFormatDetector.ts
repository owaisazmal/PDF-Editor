// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Identifies files from their bytes, and reads everything the planner needs to decide
 * what conversions are legal — without decoding a single pixel.
 *
 * The shape is declared inline rather than imported because React Native's codegen
 * resolves types within the spec file only. `src/native/types.ts` mirrors it for the
 * rest of the app, and `__tests__/native/spec-parity.test.ts` fails if the two drift.
 */
export type DetectedFileSpec = {
  uri: string;
  displayName: string;
  format: string;
  confidence: string;
  reason: string;
  claimedFormat: string;
  byteSize: number;
  pixelWidth: number;
  pixelHeight: number;
  exifOrientation: number;
  hasAlpha: boolean;
  isAnimated: boolean;
  frameCount: number;
  colorSpace: string;
  bitDepth: number;
  hasGpsMetadata: boolean;
  pageCount: number;
  isEncrypted: boolean;
  needsDownload: boolean;
};

export interface Spec extends TurboModule {
  /**
   * Reads a bounded prefix of the file, identifies it, and reads its header metadata.
   * Rejects only when the file cannot be opened at all; an unrecognised file resolves
   * with an empty `format` so a batch can continue past it.
   */
  detect(uri: string): Promise<DetectedFileSpec>;

  /** Detects many files concurrently on a background queue. Order is preserved. */
  detectMany(uris: string[]): Promise<DetectedFileSpec[]>;

  /**
   * Detects from an in-memory buffer. Exists for the conformance test that proves the
   * native detectors and the JavaScript reference implementation agree.
   */
  detectBase64(base64: string, filename: string): Promise<DetectedFileSpec>;

  /**
   * Formats this build can decode and encode on this OS version, as
   * `{ decode: string[], encode: string[] }`. The engine's capability matrix is
   * built from this at startup rather than from hardcoded version checks.
   */
  supportedFormats(): Promise<{ decode: string[]; encode: string[] }>;
}

// `get` rather than `getEnforcing`: importing a spec must not throw in Jest or on a
// build where this module is not yet linked. The wrapper in `index.ts` raises a
// specific, actionable error at call time instead.
export default TurboModuleRegistry.get<Spec>('NativeFormatDetector');
