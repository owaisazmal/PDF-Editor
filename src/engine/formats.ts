// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The canonical format table.
 *
 * A file's extension is a claim, not a fact — a `.png` that is really a HEIC is one
 * of the fifteen edge cases in the brief, and trusting the extension is how a
 * converter produces a "converted" file that is byte-identical to its input. Every
 * decision in the engine is driven by the signature match below instead.
 *
 * This table is the specification. `detectFromBytes` is its reference implementation,
 * used by tests and as the JS-side fallback. The Swift and Kotlin detectors mirror it
 * and `__tests__/engine/format-conformance.test.ts` asserts all three agree across the
 * whole fixture corpus, so a divergence fails CI rather than shipping.
 */

export type FormatId =
  | 'jpeg'
  | 'png'
  | 'gif'
  | 'bmp'
  | 'webp'
  | 'tiff'
  | 'ico'
  | 'heic'
  | 'heif'
  | 'avif'
  | 'svg'
  | 'pdf'
  | 'dng'
  | 'cr2'
  | 'cr3'
  | 'nef'
  | 'arw'
  | 'raf'
  | 'orf';

export type FormatKind = 'raster' | 'vector' | 'document' | 'raw';

/** How the format handles multiple frames. */
export type AnimationSupport = 'never' | 'optional' | 'always';

/**
 * One byte pattern that must appear at a fixed offset. `bytes` is a byte sequence;
 * ASCII is written as a string for readability and compared as Latin-1.
 */
export type SignatureClause = {
  offset: number;
  bytes: readonly number[] | string;
};

/** Every clause must match for the signature to match. */
export type Signature = {
  readonly clauses: readonly SignatureClause[];
  /** Human-readable note for why this pattern identifies the format. */
  readonly note?: string;
};

export type FormatSpec = {
  readonly id: FormatId;
  readonly label: string;
  readonly kind: FormatKind;
  /** Lowercase, without the leading dot. First entry is the canonical one. */
  readonly extensions: readonly string[];
  readonly mimeTypes: readonly string[];
  /** Uniform Type Identifier, for iOS pickers and share-sheet registration. */
  readonly uti: string;
  readonly signatures: readonly Signature[];
  readonly animation: AnimationSupport;
  readonly supportsAlpha: boolean;
  /** True when the app can read but never write this format. */
  readonly importOnly: boolean;
  /**
   * Set when the signature alone is ambiguous and a deeper parse is required to
   * be certain. The native detectors resolve these; the JS reference implementation
   * reports its best guess and sets `ambiguous`.
   */
  readonly needsDeepParse?: boolean;
};

/** ISO base media file format brands that identify a HEIC still or sequence. */
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs'] as const;
const HEIF_BRANDS = ['mif1', 'msf1'] as const;
const AVIF_BRANDS = ['avif', 'avis'] as const;

/** `....ftyp<brand>` — the box length occupies the first four bytes and is ignored. */
const ftyp = (brand: string): Signature => ({
  clauses: [
    { offset: 4, bytes: 'ftyp' },
    { offset: 8, bytes: brand },
  ],
  note: `ISO base media file format, major or compatible brand "${brand}"`,
});

export const FORMATS: Readonly<Record<FormatId, FormatSpec>> = {
  jpeg: {
    id: 'jpeg',
    label: 'JPEG',
    kind: 'raster',
    extensions: ['jpg', 'jpeg', 'jpe', 'jfif'],
    mimeTypes: ['image/jpeg'],
    uti: 'public.jpeg',
    signatures: [{ clauses: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }], note: 'SOI marker' }],
    animation: 'never',
    supportsAlpha: false,
    importOnly: false,
  },
  png: {
    id: 'png',
    label: 'PNG',
    kind: 'raster',
    extensions: ['png'],
    mimeTypes: ['image/png'],
    uti: 'public.png',
    signatures: [
      {
        clauses: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
        note: 'PNG signature; APNG is a PNG with an acTL chunk',
      },
    ],
    animation: 'optional',
    supportsAlpha: true,
    importOnly: false,
  },
  gif: {
    id: 'gif',
    label: 'GIF',
    kind: 'raster',
    extensions: ['gif'],
    mimeTypes: ['image/gif'],
    uti: 'com.compuserve.gif',
    signatures: [
      { clauses: [{ offset: 0, bytes: 'GIF87a' }] },
      { clauses: [{ offset: 0, bytes: 'GIF89a' }] },
    ],
    animation: 'optional',
    supportsAlpha: true,
    importOnly: false,
  },
  bmp: {
    id: 'bmp',
    label: 'BMP',
    kind: 'raster',
    extensions: ['bmp', 'dib'],
    mimeTypes: ['image/bmp'],
    uti: 'com.microsoft.bmp',
    signatures: [{ clauses: [{ offset: 0, bytes: 'BM' }] }],
    animation: 'never',
    supportsAlpha: true,
    importOnly: false,
  },
  webp: {
    id: 'webp',
    label: 'WebP',
    kind: 'raster',
    extensions: ['webp'],
    mimeTypes: ['image/webp'],
    uti: 'org.webmproject.webp',
    signatures: [
      {
        clauses: [
          { offset: 0, bytes: 'RIFF' },
          { offset: 8, bytes: 'WEBP' },
        ],
        note: 'RIFF container with a WEBP form type; the VP8/VP8L/VP8X chunk follows',
      },
    ],
    animation: 'optional',
    supportsAlpha: true,
    importOnly: false,
  },
  tiff: {
    id: 'tiff',
    label: 'TIFF',
    kind: 'raster',
    extensions: ['tif', 'tiff'],
    mimeTypes: ['image/tiff'],
    uti: 'public.tiff',
    signatures: [
      { clauses: [{ offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00] }], note: 'little-endian TIFF' },
      { clauses: [{ offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a] }], note: 'big-endian TIFF' },
    ],
    animation: 'never',
    supportsAlpha: true,
    importOnly: false,
    // Every TIFF-based RAW shares this header, so a bare TIFF match must be
    // confirmed by ruling out the RAW variants first.
    needsDeepParse: true,
  },
  ico: {
    id: 'ico',
    label: 'ICO',
    kind: 'raster',
    extensions: ['ico'],
    mimeTypes: ['image/x-icon', 'image/vnd.microsoft.icon'],
    uti: 'com.microsoft.ico',
    signatures: [{ clauses: [{ offset: 0, bytes: [0x00, 0x00, 0x01, 0x00] }] }],
    animation: 'never',
    supportsAlpha: true,
    importOnly: false,
  },
  heic: {
    id: 'heic',
    label: 'HEIC',
    kind: 'raster',
    extensions: ['heic', 'heics'],
    mimeTypes: ['image/heic', 'image/heic-sequence'],
    uti: 'public.heic',
    signatures: HEIC_BRANDS.map(ftyp),
    animation: 'optional',
    supportsAlpha: true,
    importOnly: false,
  },
  heif: {
    id: 'heif',
    label: 'HEIF',
    kind: 'raster',
    extensions: ['heif', 'hif'],
    mimeTypes: ['image/heif', 'image/heif-sequence'],
    uti: 'public.heif',
    signatures: HEIF_BRANDS.map(ftyp),
    animation: 'optional',
    supportsAlpha: true,
    importOnly: false,
  },
  avif: {
    id: 'avif',
    label: 'AVIF',
    kind: 'raster',
    extensions: ['avif', 'avifs'],
    mimeTypes: ['image/avif', 'image/avif-sequence'],
    uti: 'public.avif',
    signatures: AVIF_BRANDS.map(ftyp),
    animation: 'optional',
    supportsAlpha: true,
    importOnly: false,
  },
  svg: {
    id: 'svg',
    label: 'SVG',
    kind: 'vector',
    extensions: ['svg'],
    mimeTypes: ['image/svg+xml'],
    uti: 'public.svg-image',
    // SVG is text, so it has no fixed-offset signature. Detection scans a
    // bounded prefix for an <svg element — see detectFromBytes.
    signatures: [],
    animation: 'optional',
    supportsAlpha: true,
    importOnly: true,
    needsDeepParse: true,
  },
  pdf: {
    id: 'pdf',
    label: 'PDF',
    kind: 'document',
    extensions: ['pdf'],
    mimeTypes: ['application/pdf'],
    uti: 'com.adobe.pdf',
    signatures: [
      {
        clauses: [{ offset: 0, bytes: '%PDF-' }],
        note: 'Readers tolerate leading junk, so a prefix scan is also performed',
      },
    ],
    animation: 'never',
    supportsAlpha: false,
    importOnly: false,
    needsDeepParse: true,
  },
  dng: {
    id: 'dng',
    label: 'Adobe DNG',
    kind: 'raw',
    extensions: ['dng'],
    mimeTypes: ['image/x-adobe-dng'],
    uti: 'com.adobe.raw-image',
    // TIFF container. Confirmed by the DNGVersion tag (50706) in IFD0.
    signatures: [
      { clauses: [{ offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00] }] },
      { clauses: [{ offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a] }] },
    ],
    animation: 'never',
    supportsAlpha: false,
    importOnly: true,
    needsDeepParse: true,
  },
  cr2: {
    id: 'cr2',
    label: 'Canon CR2',
    kind: 'raw',
    extensions: ['cr2'],
    mimeTypes: ['image/x-canon-cr2'],
    uti: 'com.canon.cr2-raw-image',
    signatures: [
      {
        clauses: [
          { offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00] },
          { offset: 8, bytes: 'CR' },
        ],
        note: 'TIFF header with the Canon CR2 marker at offset 8',
      },
    ],
    animation: 'never',
    supportsAlpha: false,
    importOnly: true,
  },
  cr3: {
    id: 'cr3',
    label: 'Canon CR3',
    kind: 'raw',
    extensions: ['cr3'],
    mimeTypes: ['image/x-canon-cr3'],
    uti: 'com.canon.cr3-raw-image',
    signatures: [ftyp('crx ')],
    animation: 'never',
    supportsAlpha: false,
    importOnly: true,
  },
  nef: {
    id: 'nef',
    label: 'Nikon NEF',
    kind: 'raw',
    extensions: ['nef', 'nrw'],
    mimeTypes: ['image/x-nikon-nef'],
    uti: 'com.nikon.raw-image',
    // TIFF container; only the Make tag distinguishes it. Deep parse required.
    signatures: [
      { clauses: [{ offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a] }] },
      { clauses: [{ offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00] }] },
    ],
    animation: 'never',
    supportsAlpha: false,
    importOnly: true,
    needsDeepParse: true,
  },
  arw: {
    id: 'arw',
    label: 'Sony ARW',
    kind: 'raw',
    extensions: ['arw', 'sr2', 'srf'],
    mimeTypes: ['image/x-sony-arw'],
    uti: 'com.sony.raw-image',
    signatures: [{ clauses: [{ offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00] }] }],
    animation: 'never',
    supportsAlpha: false,
    importOnly: true,
    needsDeepParse: true,
  },
  raf: {
    id: 'raf',
    label: 'Fujifilm RAF',
    kind: 'raw',
    extensions: ['raf'],
    mimeTypes: ['image/x-fuji-raf'],
    uti: 'com.fuji.raw-image',
    signatures: [{ clauses: [{ offset: 0, bytes: 'FUJIFILMCCD-RAW' }] }],
    animation: 'never',
    supportsAlpha: false,
    importOnly: true,
  },
  orf: {
    id: 'orf',
    label: 'Olympus ORF',
    kind: 'raw',
    extensions: ['orf'],
    mimeTypes: ['image/x-olympus-orf'],
    uti: 'com.olympus.raw-image',
    signatures: [
      { clauses: [{ offset: 0, bytes: [0x49, 0x49, 0x52, 0x4f] }], note: 'IIRO' },
      { clauses: [{ offset: 0, bytes: [0x49, 0x49, 0x52, 0x53] }], note: 'IIRS' },
      { clauses: [{ offset: 0, bytes: [0x4d, 0x4d, 0x4f, 0x52] }], note: 'MMOR' },
    ],
    animation: 'never',
    supportsAlpha: false,
    importOnly: true,
  },
};

export const ALL_FORMAT_IDS = Object.keys(FORMATS) as FormatId[];

/**
 * Detection order matters. Formats whose signatures are strict subsets of another's
 * must be tested first, or the looser pattern wins: every TIFF-based RAW starts with
 * a plain TIFF header, and CR3 is an ISO-BMFF file like HEIC.
 */
export const DETECTION_ORDER: readonly FormatId[] = [
  // Unambiguous fixed signatures.
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'ico',
  'raf',
  'orf',
  'pdf',
  // ISO base media: specific brands before generic ones.
  'cr3',
  'avif',
  'heic',
  'heif',
  // TIFF family: most specific marker first, bare TIFF last.
  'cr2',
  'dng',
  'nef',
  'arw',
  'tiff',
  // Text-sniffed.
  'svg',
];

export const byExtension = (name: string): FormatSpec | undefined => {
  const ext = name.split('.').pop()?.toLowerCase();
  if (!ext) return undefined;
  return ALL_FORMAT_IDS.map((id) => FORMATS[id]).find((f) => f.extensions.includes(ext));
};

export const byMimeType = (mime: string): FormatSpec | undefined => {
  const normalised = mime.toLowerCase().split(';')[0]?.trim() ?? '';
  return ALL_FORMAT_IDS.map((id) => FORMATS[id]).find((f) => f.mimeTypes.includes(normalised));
};

/** Every UTI the app registers as an "Open with" handler for. */
export const ALL_UTIS: readonly string[] = ALL_FORMAT_IDS.map((id) => FORMATS[id].uti);

/** Every MIME type the Android intent filters accept. */
export const ALL_MIME_TYPES: readonly string[] = Array.from(
  new Set(ALL_FORMAT_IDS.flatMap((id) => FORMATS[id].mimeTypes)),
);
