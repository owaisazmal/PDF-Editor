// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * This app asks for exactly one runtime permission, once, and only when the answer
 * could change what the user sees. The rule that decides when is worth pinning down:
 * loosening it by accident is how an app that promises no prompts acquires one on every
 * single-file conversion.
 */

import {
  BACKGROUND_PROMPT_MIN_BYTES,
  BACKGROUND_PROMPT_MIN_FILES,
  isWorthPromptingFor,
} from '@/store/batch';
import type { DetectedFile } from '@/native/types';

// Only `byteSize` and the count matter to the rule under test; the rest is a neutral
// detection so the fixture stays a whole DetectedFile rather than a cast.
const file = (byteSize: number): DetectedFile => ({
  uri: 'file:///tmp/a.jpg',
  displayName: 'a.jpg',
  format: 'jpeg',
  confidence: 'signature',
  reason: 'JPEG SOI signature',
  claimedFormat: 'jpeg',
  byteSize,
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
});

const small = () => file(1024);
const batchOf = (count: number, bytes = 1024) => Array.from({ length: count }, () => file(bytes));

describe('when a batch is worth a permission prompt', () => {
  it('does not prompt for a single file, which is over before a phone is put down', () => {
    expect(isWorthPromptingFor([small()])).toBe(false);
  });

  it('does not prompt just below the file threshold', () => {
    expect(isWorthPromptingFor(batchOf(BACKGROUND_PROMPT_MIN_FILES - 1))).toBe(false);
  });

  it('prompts at the file threshold', () => {
    expect(isWorthPromptingFor(batchOf(BACKGROUND_PROMPT_MIN_FILES))).toBe(true);
  });

  it('prompts for one file large enough to take a while on its own', () => {
    // A single raw frame is a small batch by count and a long one by work, which is
    // exactly the case a file count alone would miss.
    expect(isWorthPromptingFor([file(BACKGROUND_PROMPT_MIN_BYTES)])).toBe(true);
  });

  it('adds sizes across the batch rather than looking at the largest file', () => {
    const half = Math.ceil(BACKGROUND_PROMPT_MIN_BYTES / 2);
    expect(isWorthPromptingFor([file(half), file(half)])).toBe(true);
  });

  it('never prompts for an empty selection', () => {
    expect(isWorthPromptingFor([])).toBe(false);
  });
});
