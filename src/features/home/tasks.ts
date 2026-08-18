// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import type { FormatId } from '@/engine/formats';
import { canConvert, canDoPdf, type CapabilitiesState, type PdfOperation } from '@/store/capabilities';

/**
 * The home screen's entry points.
 *
 * These are tasks, not formats. Each title is deliberately the phrase people type into
 * the App Store and Play search — "HEIC to JPG" outranks any name we could invent — so
 * the home screen and the store listing keyword set are the same list.
 *
 * `phase` records when each becomes real. Tiles beyond the current phase render in a
 * disabled state rather than being hidden, so the information architecture is visible
 * from the first build and the layout does not reflow as phases land.
 */
export type ConversionTask = {
  id: string;
  title: string;
  subtitle: string;
  from: string;
  to: string;
  sourceFormats: FormatId[];
  targetFormat: FormatId;
  /** The brief defines six; the union is all of them so a later tile needs no edit here. */
  phase: 1 | 2 | 3 | 4 | 5 | 6;
  /**
   * True when the task is only meaningful with settings the user chooses — a
   * "Compress Image" that silently picks a quality is not compressing to anything in
   * particular. These stay closed until the transform options screen exists.
   */
  needsOptions?: boolean;
  /**
   * Which engine runs it. PDF tasks take a different route through the app: a document
   * picker rather than a photo picker, their own options, and results that are documents
   * or page images rather than converted files.
   */
  kind?: 'raster' | 'pdf';
  /**
   * The PDF capability this task needs. Checked separately from the format matrix
   * because "can read PDF" and "can merge PDFs" are different questions, and Android
   * answers them differently.
   */
  pdfOperation?: PdfOperation;
  /** Where the input comes from. PDFs are never in the photo library. */
  picker?: 'photos' | 'documents';
  /** True when the task is meaningless with one file. */
  needsMultiple?: boolean;
};

export const CONVERSION_TASKS: readonly ConversionTask[] = [
  {
    id: 'heic-to-jpg',
    title: 'HEIC to JPG',
    subtitle: 'iPhone photos anything can open',
    from: 'HEIC',
    to: 'JPG',
    sourceFormats: ['heic', 'heif'],
    targetFormat: 'jpeg',
    phase: 1,
  },
  {
    id: 'webp-to-jpg',
    title: 'WebP to JPG',
    subtitle: 'Saved images that will not open',
    from: 'WEBP',
    to: 'JPG',
    sourceFormats: ['webp'],
    targetFormat: 'jpeg',
    phase: 2,
  },
  {
    id: 'compress-image',
    title: 'Compress Image',
    subtitle: 'Hit a size limit without the guesswork',
    from: 'ANY',
    to: 'JPG',
    sourceFormats: ['jpeg', 'png', 'heic', 'webp'],
    targetFormat: 'jpeg',
    phase: 2,
    needsOptions: true,
  },
  {
    id: 'resize-image',
    title: 'Resize Image',
    subtitle: 'Presets for social, email and print',
    from: 'ANY',
    to: 'ANY',
    sourceFormats: ['jpeg', 'png', 'heic', 'webp'],
    targetFormat: 'jpeg',
    phase: 2,
    needsOptions: true,
  },
  {
    id: 'image-to-pdf',
    title: 'Image to PDF',
    subtitle: 'Many photos, one document',
    from: 'IMG',
    to: 'PDF',
    sourceFormats: ['jpeg', 'png', 'heic', 'webp'],
    targetFormat: 'pdf',
    phase: 3,
    kind: 'pdf',
    pdfOperation: 'compose',
    picker: 'photos',
  },
  {
    id: 'pdf-to-jpg',
    title: 'PDF to JPG',
    subtitle: 'Pages as images, at your chosen DPI',
    from: 'PDF',
    to: 'JPG',
    sourceFormats: ['pdf'],
    targetFormat: 'jpeg',
    phase: 3,
    kind: 'pdf',
    pdfOperation: 'render',
    picker: 'documents',
  },
  {
    id: 'merge-pdf',
    title: 'Merge PDF',
    subtitle: 'Combine and reorder in one pass',
    from: 'PDF',
    to: 'PDF',
    sourceFormats: ['pdf'],
    targetFormat: 'pdf',
    phase: 3,
    kind: 'pdf',
    pdfOperation: 'merge',
    picker: 'documents',
    needsMultiple: true,
  },
  {
    id: 'split-pdf',
    title: 'Split PDF',
    subtitle: 'Pull out pages, or break it up',
    from: 'PDF',
    to: 'PDF',
    sourceFormats: ['pdf'],
    targetFormat: 'pdf',
    phase: 3,
    kind: 'pdf',
    pdfOperation: 'split',
    picker: 'documents',
  },
  {
    id: 'compress-pdf',
    title: 'Compress PDF',
    subtitle: 'Smaller file, at a cost worth knowing',
    from: 'PDF',
    to: 'PDF',
    sourceFormats: ['pdf'],
    targetFormat: 'pdf',
    phase: 3,
    kind: 'pdf',
    pdfOperation: 'compress',
    picker: 'documents',
  },
  {
    id: 'png-to-jpg',
    title: 'PNG to JPG',
    subtitle: 'Smaller files, with a background you pick',
    from: 'PNG',
    to: 'JPG',
    sourceFormats: ['png'],
    targetFormat: 'jpeg',
    phase: 2,
  },
];

/** The phase this build implements. Bumped as each phase lands. */
export const CURRENT_PHASE = 3 as const;

/** Set once the transform options screen exists; until then, see `needsOptions`. */
export const HAS_TRANSFORM_OPTIONS = true;

/**
 * Whether this build offers the task at all — before the device is consulted.
 *
 * Kept separate from the capability check so the two reasons a tile can be closed stay
 * distinguishable: "not built yet" is a promise, "your device cannot do this" is a fact,
 * and telling a user the wrong one is how a bug report gets filed against a phone.
 */
export const isTaskAvailable = (task: ConversionTask): boolean => {
  if (task.phase > CURRENT_PHASE) return false;
  if (task.needsOptions && !HAS_TRANSFORM_OPTIONS) return false;
  return true;
};

/** Whether the device can actually perform it. */
export const isTaskSupported = (
  task: ConversionTask,
  capabilities: Pick<CapabilitiesState, 'decode' | 'encode' | 'pdfOperations' | 'isLoaded'>,
): boolean => {
  if (!canConvert(capabilities, task.sourceFormats, task.targetFormat)) return false;
  // A PDF task can clear the format matrix and still be impossible: Android reads and
  // writes PDF but cannot move a page between two of them.
  if (task.pdfOperation && !canDoPdf(capabilities, task.pdfOperation)) return false;
  return true;
};

/** Why a tile is closed, in the user's terms. Null when it is open. */
export function unavailableReason(
  task: ConversionTask,
  capabilities: Pick<CapabilitiesState, 'decode' | 'encode' | 'pdfOperations' | 'isLoaded'>,
): string | null {
  // Checked before the device reason, because it is a different claim. "Not supported on
  // this device" says the hardware or OS cannot; a missing PDF operation says this build
  // cannot, on this platform. Telling a user the first when the second is true is how a
  // bug report gets filed against a phone that is working fine.
  if (task.pdfOperation && !canDoPdf(capabilities, task.pdfOperation)) {
    return 'Not available on this platform yet';
  }
  if (!isTaskSupported(task, capabilities)) return 'Not supported on this device';
  if (task.needsOptions && !HAS_TRANSFORM_OPTIONS) return 'Needs the settings screen';
  if (task.phase > CURRENT_PHASE) return 'Coming in a later build';
  return null;
}

/**
 * Whether a tile should respond to a tap.
 *
 * Extracted and named because getting it wrong took the whole app down once: the rule
 * used to be "no tile is interactive while any pick is in flight", so a native picker
 * whose promise never settled left every tile dead with no way back short of
 * relaunching. The rule is now strictly per-tile — one outstanding pick dims exactly
 * one tile.
 *
 * `busyTaskId` is the id of the tile whose pick is outstanding, or null.
 */
export function isTileInteractive(
  task: ConversionTask,
  busyTaskId: string | null,
  capabilities?: Pick<CapabilitiesState, 'decode' | 'encode' | 'pdfOperations' | 'isLoaded'>,
): boolean {
  if (busyTaskId === task.id) return false;
  if (!isTaskAvailable(task)) return false;
  return capabilities ? isTaskSupported(task, capabilities) : true;
}
