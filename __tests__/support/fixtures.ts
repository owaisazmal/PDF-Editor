// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Fixtures shaped like what native hands back.
 *
 * Built from the real types rather than cast from a partial, so a field added to
 * `DetectedFile` or `ConversionResult` breaks compilation here instead of leaving every
 * screen test rendering against a shape the app never sees.
 */

import type { ConversionResult, DetectedFile } from '@/native/types';
import type { FormatId } from '@/engine/formats';

export function detectedFile(
  format: FormatId | '' = 'heic',
  overrides: Partial<DetectedFile> = {},
): DetectedFile {
  const name = overrides.displayName ?? `IMG_0001.${format || 'bin'}`;
  return {
    uri: `file:///tmp/${name}`,
    displayName: name,
    format,
    confidence: format === '' ? 'none' : 'signature',
    reason: 'test fixture',
    claimedFormat: format,
    byteSize: 2_400_000,
    pixelWidth: 4032,
    pixelHeight: 3024,
    exifOrientation: 1,
    hasAlpha: false,
    isAnimated: false,
    frameCount: 1,
    colorSpace: 'sRGB',
    bitDepth: 8,
    hasGpsMetadata: false,
    pageCount: 0,
    isEncrypted: false,
    needsDownload: false,
    ...overrides,
  };
}

export function conversionResult(overrides: Partial<ConversionResult> = {}): ConversionResult {
  return {
    sourceIndex: -1,
    outputUri: 'file:///tmp/IMG_0001.jpg',
    outputDisplayName: 'IMG_0001.jpg',
    format: 'jpeg',
    byteSize: 780_000,
    pixelWidth: 4032,
    pixelHeight: 3024,
    qualityUsed: 82,
    elapsedMs: 240,
    ...overrides,
  };
}
