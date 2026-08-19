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
 * The words themselves are not here. `id` doubles as the catalogue key, so a tile reads
 * its title from `tasks.<id>.title` and there is exactly one copy of each string in the
 * repository. Holding the English here as well would mean nine files plus this one, and
 * this one would win silently.
 *
 * `phase` records when each becomes real. Tiles beyond the current phase render in a
 * disabled state rather than being hidden, so the information architecture is visible
 * from the first build and the layout does not reflow as phases land.
 */
export type ConversionTask = {
  /** Also the catalogue key: `tasks.<id>.title` and `tasks.<id>.subtitle`. */
  id: string;
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
    from: 'HEIC',
    to: 'JPG',
    sourceFormats: ['heic', 'heif'],
    targetFormat: 'jpeg',
    phase: 1,
  },
  {
    id: 'webp-to-jpg',
    from: 'WEBP',
    to: 'JPG',
    sourceFormats: ['webp'],
    targetFormat: 'jpeg',
    phase: 2,
  },
  {
    id: 'compress-image',
    from: 'ANY',
    to: 'JPG',
    sourceFormats: ['jpeg', 'png', 'heic', 'webp'],
    targetFormat: 'jpeg',
    phase: 2,
    needsOptions: true,
  },
  {
    id: 'resize-image',
    from: 'ANY',
    to: 'ANY',
    sourceFormats: ['jpeg', 'png', 'heic', 'webp'],
    targetFormat: 'jpeg',
    phase: 2,
    needsOptions: true,
  },
  {
    id: 'image-to-pdf',
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

/**
 * Why a tile is closed. Null when it is open.
 *
 * An identifier rather than a sentence, because this is a plain module and cannot reach
 * `t`. The four values are exactly the four `home.unavailable.*` keys, so the screen
 * translates it with a lookup and the compiler checks the set is covered.
 */
export type UnavailableReason = 'platform' | 'device' | 'settings' | 'later';

export function unavailableReason(
  task: ConversionTask,
  capabilities: Pick<CapabilitiesState, 'decode' | 'encode' | 'pdfOperations' | 'isLoaded'>,
): UnavailableReason | null {
  // Checked before the device reason, because it is a different claim. "Not supported on
  // this device" says the hardware or OS cannot; a missing PDF operation says this build
  // cannot, on this platform. Telling a user the first when the second is true is how a
  // bug report gets filed against a phone that is working fine.
  if (task.pdfOperation && !canDoPdf(capabilities, task.pdfOperation)) {
    return 'platform';
  }
  if (!isTaskSupported(task, capabilities)) return 'device';
  if (task.needsOptions && !HAS_TRANSFORM_OPTIONS) return 'settings';
  if (task.phase > CURRENT_PHASE) return 'later';
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
