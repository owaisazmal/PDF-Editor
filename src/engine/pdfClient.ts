// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The PDF engine's JavaScript surface: strict on the way out, defensive on the way in.
 *
 * Codegen cannot express these option structures, so validation happens here — which
 * makes this file the actual contract. A page range that means nothing, a DPI that would
 * allocate a gigabyte, or a fit mode nobody implemented all fail here with a readable
 * message rather than reaching Swift or Kotlin and producing something surprising.
 *
 * Passwords are the one thing that crosses in only one direction. `unlock` takes one and
 * returns an opaque handle; nothing here ever holds, stores or logs the password itself.
 */

import { z } from 'zod';

import { imageDefaults } from '@/theme/tokens';
import { pdfEngine } from '@/native';

/* ------------------------------------------------------------------ outbound ---- */

/**
 * `fit` is not a paper size — it means "make the page the shape of the image", which is
 * what people want when a screenshot becomes a PDF and an A4 sheet would be mostly
 * margin.
 */
export const PDF_PAGE_SIZES = ['fit', 'a3', 'a4', 'a5', 'letter', 'legal', 'tabloid'] as const;
export type PdfPageSize = (typeof PDF_PAGE_SIZES)[number];

export const PDF_ORIENTATIONS = ['auto', 'portrait', 'landscape'] as const;
export type PdfOrientation = (typeof PDF_ORIENTATIONS)[number];

/** `fit` never crops, `fill` crops to cover, `stretch` distorts. */
export const PDF_FIT_MODES = ['fit', 'fill', 'stretch'] as const;
export type PdfFitMode = (typeof PDF_FIT_MODES)[number];

/** Only the counts that tile evenly. Anything else leaves a ragged page. */
export const PDF_N_UP = [1, 2, 4, 6, 9] as const;

/**
 * Rejects a range that parses to nothing, rather than letting it mean "everything".
 * Exporting 400 pages when the user typed `4OO` is the failure worth preventing.
 */
const pageRanges = z
  .string()
  .regex(
    /^\s*$|^\s*\d*\s*-?\s*\d*\s*(,\s*\d*\s*-?\s*\d*\s*)*$/,
    'Page ranges look like 1-3, 7, 9- — numbers, dashes and commas only.',
  )
  .default('');

/**
 * Clamped at both ends. Below 36 the text is unreadable; above 600 an A4 page is a
 * 100-megapixel allocation, which is a crash rather than a document.
 */
const dpi = z.number().min(36).max(600).default(150);

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'A page background must be an opaque #RRGGBB colour.');

export const pdfRenderOptionsSchema = z.object({
  pageRanges,
  dpi,
  /** The formats both platforms can encode from a rendered page. */
  format: z.enum(['jpeg', 'png', 'webp']).default('jpeg'),
  quality: z.number().int().min(1).max(100).default(90),
  outputDirectory: z.string().default(''),
  namePrefix: z.string().default(''),
});

export const pdfComposeOptionsSchema = z.object({
  pageSize: z.enum(PDF_PAGE_SIZES).default('a4'),
  orientation: z.enum(PDF_ORIENTATIONS).default('auto'),
  fitMode: z.enum(PDF_FIT_MODES).default('fit'),
  /** 36 points is half an inch — the smallest margin most printers will not clip. */
  marginPoints: z.number().min(0).max(216).default(36),
  nUp: z
    .number()
    .int()
    .refine((value) => (PDF_N_UP as readonly number[]).includes(value), 'Unsupported N-up count.')
    .default(1),
  gutterPoints: z.number().min(0).max(72).default(12),
  dpi,
  // The same token that backs transparency flattening: paper is white for the same
  // reason a flattened PNG is, and a page background is image data rather than theme.
  backgroundColor: hexColor.default(imageDefaults.backgroundFill),
});

export const pdfSplitOptionsSchema = z.object({
  ranges: pageRanges,
  everyNPages: z.number().int().min(1).default(1),
  namePrefix: z.string().default(''),
});

export const pdfCompressOptionsSchema = z.object({
  dpi: z.number().min(36).max(600).default(150),
  quality: z.number().int().min(1).max(100).default(70),
  /** Halves the size of a scanned text document at no readable cost. */
  grayscale: z.boolean().default(false),
});

export const pdfEditOperationsSchema = z.object({
  /** Zero-based, against the original numbering the user was looking at. */
  delete: z.array(z.number().int().min(0)).default([]),
  /** Page index to a rotation delta in degrees; negative is anticlockwise. */
  rotate: z.record(z.string(), z.number().int()).default({}),
  /** A partial order is allowed: anything omitted keeps its place after what is listed. */
  order: z.array(z.number().int().min(0)).default([]),
});

export type PdfRenderOptionsInput = z.input<typeof pdfRenderOptionsSchema>;
export type PdfComposeOptionsInput = z.input<typeof pdfComposeOptionsSchema>;
export type PdfSplitOptionsInput = z.input<typeof pdfSplitOptionsSchema>;
export type PdfCompressOptionsInput = z.input<typeof pdfCompressOptionsSchema>;
export type PdfEditOperationsInput = z.input<typeof pdfEditOperationsSchema>;

/* ------------------------------------------------------------------- inbound ---- */

export type PdfPageInfo = {
  index: number;
  widthPoints: number;
  heightPoints: number;
  rotation: number;
};

export type PdfInfo = {
  uri: string;
  pageCount: number;
  isEncrypted: boolean;
  /** True when the document cannot be read until a password is supplied. */
  needsPassword: boolean;
  pages: PdfPageInfo[];
  title: string;
};

export type PdfDocumentResult = {
  outputUri: string;
  outputDisplayName: string;
  pageCount: number;
  byteSize: number;
  elapsedMs: number;
  /** Only set by `compress`, which is the one operation with a before to compare to. */
  beforeByteSize: number;
};

export type PdfPageImage = {
  sourceIndex: number;
  outputUri: string;
  outputDisplayName: string;
  format: string;
  byteSize: number;
  pixelWidth: number;
  pixelHeight: number;
};

export type PdfPart = {
  outputUri: string;
  outputDisplayName: string;
  pageCount: number;
  byteSize: number;
  /** One-based, so the UI can say "pages 4-6" rather than "part 2". */
  sourcePages: number[];
};

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === 'boolean' ? value : fallback;

function narrowPageInfo(raw: unknown): PdfPageInfo {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    index: asNumber(source.index, -1),
    widthPoints: asNumber(source.widthPoints),
    heightPoints: asNumber(source.heightPoints),
    rotation: asNumber(source.rotation),
  };
}

export function narrowPdfInfo(raw: unknown): PdfInfo {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    uri: asString(source.uri),
    pageCount: asNumber(source.pageCount),
    isEncrypted: asBoolean(source.isEncrypted),
    // Defaulting to "locked" when the field is missing would put a password prompt in
    // front of a document that opens fine, so the safe default here is the open one.
    needsPassword: asBoolean(source.needsPassword),
    pages: Array.isArray(source.pages) ? source.pages.map(narrowPageInfo) : [],
    title: asString(source.title),
  };
}

function narrowDocument(raw: unknown): PdfDocumentResult {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    outputUri: asString(source.outputUri),
    outputDisplayName: asString(source.outputDisplayName),
    pageCount: asNumber(source.pageCount),
    byteSize: asNumber(source.byteSize),
    elapsedMs: asNumber(source.elapsedMs),
    beforeByteSize: asNumber(source.beforeByteSize),
  };
}

function narrowPageImage(raw: unknown): PdfPageImage {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    sourceIndex: asNumber(source.sourceIndex, -1),
    outputUri: asString(source.outputUri),
    outputDisplayName: asString(source.outputDisplayName),
    format: asString(source.format),
    byteSize: asNumber(source.byteSize),
    pixelWidth: asNumber(source.pixelWidth),
    pixelHeight: asNumber(source.pixelHeight),
  };
}

function narrowPart(raw: unknown): PdfPart {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    outputUri: asString(source.outputUri),
    outputDisplayName: asString(source.outputDisplayName),
    pageCount: asNumber(source.pageCount),
    byteSize: asNumber(source.byteSize),
    sourcePages: Array.isArray(source.sourcePages)
      ? source.sourcePages.map((page) => asNumber(page))
      : [],
  };
}

/* -------------------------------------------------------------------- client ---- */

class PdfEngineUnavailableError extends Error {
  constructor() {
    super(
      'The native PDF engine is not linked into this build. Run `npm run prebuild` and ' +
        'rebuild — this app cannot run in Expo Go.',
    );
    this.name = 'PdfEngineUnavailableError';
  }
}

const required = () => {
  if (pdfEngine == null) throw new PdfEngineUnavailableError();
  return pdfEngine;
};

export const pdfClient = {
  /** True when this build can do anything with PDFs at all. */
  isAvailable: (): boolean => pdfEngine != null,

  /**
   * Page count, page sizes and whether a password is needed.
   *
   * Safe to call on a locked document — the encryption state is exactly what the UI
   * needs in order to decide whether to ask for a password.
   */
  async inspect(uri: string): Promise<PdfInfo> {
    return narrowPdfInfo(await required().inspect(uri));
  },

  /**
   * Verifies a password and returns a session handle to pass to later calls.
   *
   * The password goes in and does not come back out. Callers hold the handle, never the
   * password, so there is nothing for a state store or a crash log to capture.
   */
  unlock: (uri: string, password: string): Promise<string> => required().unlock(uri, password),

  /** Discards an unlock session. Call it when the user leaves the document. */
  closeSession: (sessionHandle: string): void => {
    pdfEngine?.closeSession(sessionHandle);
  },

  async renderPages(
    uri: string,
    sessionHandle: string,
    options: PdfRenderOptionsInput,
  ): Promise<{ results: PdfPageImage[]; elapsedMs: number }> {
    const validated = pdfRenderOptionsSchema.parse(options);
    const raw = (await required().renderPages(uri, sessionHandle, validated)) as Record<
      string,
      unknown
    >;
    return {
      results: Array.isArray(raw?.results) ? raw.results.map(narrowPageImage) : [],
      elapsedMs: asNumber(raw?.elapsedMs),
    };
  },

  /** An empty `outputUri` lets native choose a path in its managed output directory. */
  async composeFromImages(
    imageUris: string[],
    outputUri: string,
    options: PdfComposeOptionsInput,
  ): Promise<PdfDocumentResult> {
    const validated = pdfComposeOptionsSchema.parse(options);
    return narrowDocument(await required().composeFromImages(imageUris, outputUri, validated));
  },

  async merge(uris: string[], outputUri: string): Promise<PdfDocumentResult> {
    if (uris.length < 2) throw new Error('Merging needs at least two documents.');
    return narrowDocument(await required().merge(uris, outputUri));
  },

  async split(
    uri: string,
    outputDirectory: string,
    options: PdfSplitOptionsInput,
  ): Promise<{ results: PdfPart[]; elapsedMs: number }> {
    const validated = pdfSplitOptionsSchema.parse(options);
    const raw = (await required().split(uri, outputDirectory, validated)) as Record<
      string,
      unknown
    >;
    return {
      results: Array.isArray(raw?.results) ? raw.results.map(narrowPart) : [],
      elapsedMs: asNumber(raw?.elapsedMs),
    };
  },

  async editPages(
    uri: string,
    outputUri: string,
    operations: PdfEditOperationsInput,
  ): Promise<PdfDocumentResult> {
    const validated = pdfEditOperationsSchema.parse(operations);
    return narrowDocument(await required().editPages(uri, outputUri, validated));
  },

  /**
   * Rasterises and re-encodes. This flattens selectable text into pictures of text, so
   * the UI warns before applying rather than letting it be discovered afterwards.
   */
  async compress(
    uri: string,
    outputUri: string,
    options: PdfCompressOptionsInput,
  ): Promise<PdfDocumentResult> {
    const validated = pdfCompressOptionsSchema.parse(options);
    return narrowDocument(await required().compress(uri, outputUri, validated));
  },
};
