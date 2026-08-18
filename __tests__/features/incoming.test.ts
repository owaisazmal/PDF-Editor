// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * A share sheet hands over files without a task, so the app has to work out what it can
 * offer. Getting this wrong in the permissive direction is the worse failure: offering
 * "PDF to JPG" for three photos produces a screen whose only possible outcome is an
 * error, and the user did not ask for it in the first place.
 */

import { applicableTasks, filesFor } from '@/features/incoming/applicable';
import type { DetectedFile } from '@/native/types';
import type { FormatId } from '@/engine/formats';

const file = (format: FormatId | '', name = 'a'): DetectedFile => ({
  uri: `file:///tmp/${name}`,
  displayName: name,
  format,
  confidence: format === '' ? 'none' : 'signature',
  reason: 'test fixture',
  claimedFormat: format,
  byteSize: 1024,
  pixelWidth: 100,
  pixelHeight: 100,
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

/** Everything available, so the tests measure the rules rather than the device. */
const capable = {
  decode: new Set(['jpeg', 'png', 'heic', 'webp', 'pdf']) as never,
  encode: new Set(['jpeg', 'png', 'webp', 'pdf']) as never,
  pdfOperations: new Set([
    'inspect', 'render', 'compose', 'compress', 'merge', 'split', 'edit', 'unlock',
  ]) as never,
  isLoaded: true,
};

const idsFor = (files: DetectedFile[]) =>
  applicableTasks(files, capable).map((entry) => entry.task.id);

describe('what to offer for files someone sent', () => {
  it('offers nothing at all for an empty selection', () => {
    expect(applicableTasks([], capable)).toEqual([]);
  });

  it('never offers a task that cannot read any of the files', () => {
    // Three photos must not be offered a task that only reads PDFs.
    const offered = idsFor([file('heic'), file('heic', 'b'), file('heic', 'c')]);
    expect(offered).not.toContain('pdf-to-jpg');
    expect(offered).not.toContain('split-pdf');
    expect(offered).not.toContain('compress-pdf');
  });

  it('offers the image tasks for images', () => {
    const offered = idsFor([file('heic')]);
    expect(offered).toContain('heic-to-jpg');
    expect(offered).toContain('image-to-pdf');
  });

  it('offers the PDF tasks for a PDF', () => {
    const offered = idsFor([file('pdf')]);
    expect(offered).toContain('pdf-to-jpg');
    expect(offered).toContain('split-pdf');
  });

  it('withholds a task that needs two documents when only one arrived', () => {
    expect(idsFor([file('pdf')])).not.toContain('merge-pdf');
    expect(idsFor([file('pdf'), file('pdf', 'b')])).toContain('merge-pdf');
  });

  it('ranks a task that takes the whole selection above one that takes part of it', () => {
    // A mixed share: three images and one PDF. The image tasks can use three quarters
    // of it, so they belong above the PDF ones.
    const mixed = [file('heic'), file('heic', 'b'), file('heic', 'c'), file('pdf', 'd')];
    const ranked = applicableTasks(mixed, capable);
    const first = ranked[0];
    expect(first?.matchCount).toBe(3);
  });

  it('ignores files it could not identify', () => {
    // An unidentified file is not silently fed to a task that would fail on it.
    const offered = idsFor([file('')]);
    expect(offered).toEqual([]);
  });

  it('hands a task only the files it can read', () => {
    const mixed = [file('heic'), file('pdf', 'b'), file('')];
    const heicTask = applicableTasks(mixed, capable).find((e) => e.task.id === 'heic-to-jpg');
    expect(heicTask).toBeDefined();
    expect(filesFor(heicTask!.task, mixed).map((f) => f.displayName)).toEqual(['a']);
  });
});
