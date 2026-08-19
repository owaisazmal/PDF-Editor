// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Reference implementation of format detection.
 *
 * The native detectors are the ones that run in production — they are faster and they
 * read dimensions and metadata in the same pass. This one exists so the rules live in
 * a single readable place, so tests can assert against it without a device, and so the
 * conformance test can prove native and JS agree.
 *
 * It reads only a bounded prefix of the file. Nothing here ever decodes pixels.
 */

import {
  DETECTION_ORDER,
  FORMATS,
  type FormatId,
  type FormatSpec,
  type Signature,
  type SignatureClause,
  byExtension,
} from './formats';

/** Enough for every fixed signature, both TIFF IFD0 layouts, and the SVG prefix scan. */
export const SNIFF_BYTES = 4096;

export type DetectionConfidence =
  /** A fixed-offset signature matched and nothing more specific could apply. */
  | 'signature'
  /** A container parse was needed to choose between formats sharing a header. */
  | 'deep'
  /** Nothing matched. */
  | 'none';

export type Detection = {
  readonly format: FormatId | null;
  readonly confidence: DetectionConfidence;
  /** Human-readable explanation, surfaced in error states and useful in bug reports. */
  readonly reason: string;
  /**
   * True when the filename claimed a different format than the bytes. The engine
   * always believes the bytes; this flag exists so the UI can say so.
   */
  readonly extensionMismatch: boolean;
  /** What the filename claimed, when it claimed anything recognisable. */
  readonly claimedFormat: FormatId | null;
};

/* ------------------------------------------------------------- byte helpers ---- */

const toBytes = (bytes: readonly number[] | string): readonly number[] =>
  typeof bytes === 'string' ? Array.from(bytes, (c) => c.charCodeAt(0)) : bytes;

function clauseMatches(data: Uint8Array, clause: SignatureClause): boolean {
  const expected = toBytes(clause.bytes);
  if (clause.offset + expected.length > data.length) return false;
  for (let i = 0; i < expected.length; i += 1) {
    if (data[clause.offset + i] !== expected[i]) return false;
  }
  return true;
}

const signatureMatches = (data: Uint8Array, signature: Signature): boolean =>
  signature.clauses.every((clause) => clauseMatches(data, clause));

const matchesAnySignature = (data: Uint8Array, spec: FormatSpec): boolean =>
  spec.signatures.some((signature) => signatureMatches(data, signature));

/** Finds a byte pattern within a bounded window. Used for PDF's tolerated leading junk. */
function indexOfPattern(data: Uint8Array, pattern: string, limit: number): number {
  const needle = toBytes(pattern);
  const end = Math.min(data.length, limit) - needle.length;
  outer: for (let i = 0; i <= end; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (data[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/* -------------------------------------------------------------- TIFF family ---- */

const TAG_MAKE = 0x010f;
const TAG_DNG_VERSION = 0xc612;

type TiffHeader = { littleEndian: boolean; ifd0Offset: number };

function readTiffHeader(data: Uint8Array): TiffHeader | null {
  if (data.length < 8) return null;
  const isLE = data[0] === 0x49 && data[1] === 0x49;
  const isBE = data[0] === 0x4d && data[1] === 0x4d;
  if (!isLE && !isBE) return null;

  const u16 = (o: number) =>
    isLE ? (data[o]! | (data[o + 1]! << 8)) : ((data[o]! << 8) | data[o + 1]!);
  const u32 = (o: number) =>
    isLE
      ? (data[o]! | (data[o + 1]! << 8) | (data[o + 2]! << 16) | (data[o + 3]! << 24)) >>> 0
      : ((data[o]! << 24) | (data[o + 1]! << 16) | (data[o + 2]! << 8) | data[o + 3]!) >>> 0;

  if (u16(2) !== 42) return null;
  return { littleEndian: isLE, ifd0Offset: u32(4) };
}

type TiffFacts = { hasDngVersion: boolean; make: string | null };

/**
 * Walks IFD0 far enough to tell the TIFF-based RAW formats apart. Deliberately does
 * not follow sub-IFDs — everything needed is in IFD0, and a bounded read keeps a
 * malicious or truncated file from costing anything.
 */
function readTiffFacts(data: Uint8Array): TiffFacts | null {
  const header = readTiffHeader(data);
  if (!header) return null;
  const { littleEndian: isLE, ifd0Offset } = header;

  const u16 = (o: number) =>
    isLE ? (data[o]! | (data[o + 1]! << 8)) : ((data[o]! << 8) | data[o + 1]!);
  const u32 = (o: number) =>
    isLE
      ? (data[o]! | (data[o + 1]! << 8) | (data[o + 2]! << 16) | (data[o + 3]! << 24)) >>> 0
      : ((data[o]! << 24) | (data[o + 1]! << 16) | (data[o + 2]! << 8) | data[o + 3]!) >>> 0;

  if (ifd0Offset + 2 > data.length) return null;
  const entryCount = u16(ifd0Offset);
  // A plausible IFD0 has tens of entries, not thousands. Anything else is corrupt.
  if (entryCount === 0 || entryCount > 512) return null;

  let hasDngVersion = false;
  let make: string | null = null;

  for (let i = 0; i < entryCount; i += 1) {
    const entry = ifd0Offset + 2 + i * 12;
    if (entry + 12 > data.length) break;

    const tag = u16(entry);
    if (tag === TAG_DNG_VERSION) {
      hasDngVersion = true;
      continue;
    }
    if (tag !== TAG_MAKE) continue;

    const count = u32(entry + 4);
    // ASCII values of 4 bytes or fewer are stored inline; longer ones are referenced.
    const valueOffset = count <= 4 ? entry + 8 : u32(entry + 8);
    if (valueOffset >= data.length) continue;

    const end = Math.min(valueOffset + count, data.length);
    let text = '';
    for (let p = valueOffset; p < end; p += 1) {
      const byte = data[p]!;
      if (byte === 0) break;
      text += String.fromCharCode(byte);
    }
    make = text.trim();
  }

  return { hasDngVersion, make };
}

/** Chooses among the formats that all present a bare TIFF header. */
function resolveTiffFamily(data: Uint8Array): { format: FormatId; reason: string } {
  const facts = readTiffFacts(data);

  if (facts?.hasDngVersion) {
    return { format: 'dng', reason: 'TIFF container carrying the DNGVersion tag (50706)' };
  }

  const make = facts?.make?.toUpperCase() ?? '';
  if (make.includes('NIKON')) {
    return { format: 'nef', reason: `TIFF container, EXIF Make "${facts?.make}"` };
  }
  if (make.includes('SONY')) {
    return { format: 'arw', reason: `TIFF container, EXIF Make "${facts?.make}"` };
  }
  if (make.includes('OLYMPUS')) {
    return { format: 'orf', reason: `TIFF container, EXIF Make "${facts?.make}"` };
  }
  if (make.includes('CANON')) {
    return { format: 'cr2', reason: `TIFF container, EXIF Make "${facts?.make}"` };
  }

  return {
    format: 'tiff',
    reason: facts
      ? 'TIFF container with no RAW marker in IFD0'
      : 'TIFF header; IFD0 unreadable, treating as a plain TIFF',
  };
}

/* ---------------------------------------------------------------------- SVG ---- */

/**
 * SVG is XML, so there is no signature. Scanning a bounded prefix for an `<svg`
 * element start is both what browsers do and what keeps a huge text file cheap.
 */
function looksLikeSvg(data: Uint8Array): boolean {
  const limit = Math.min(data.length, SNIFF_BYTES);
  let text = '';
  for (let i = 0; i < limit; i += 1) {
    const byte = data[i]!;
    // Any NUL in the prefix means this is binary, not XML.
    if (byte === 0) return false;
    text += String.fromCharCode(byte);
  }
  return /<svg[\s>]/i.test(text);
}

/* ------------------------------------------------------------------ detector ---- */

/**
 * Identifies a file from its leading bytes.
 *
 * @param data  The first {@link SNIFF_BYTES} of the file. Passing the whole file is
 *              allowed but wasteful; nothing beyond the prefix is read.
 * @param filename Optional. Used only to report a mismatch, never to decide.
 */
export function detectFromBytes(data: Uint8Array, filename?: string): Detection {
  const claimed = filename ? (byExtension(filename)?.id ?? null) : null;

  const settle = (
    format: FormatId | null,
    confidence: DetectionConfidence,
    reason: string,
  ): Detection => ({
    format,
    confidence,
    reason,
    claimedFormat: claimed,
    extensionMismatch: format !== null && claimed !== null && claimed !== format,
  });

  if (data.length === 0) {
    return settle(null, 'none', 'The file is empty (zero bytes).');
  }

  for (const id of DETECTION_ORDER) {
    const spec = FORMATS[id];

    if (id === 'svg') {
      if (looksLikeSvg(data)) {
        return settle('svg', 'deep', 'XML prefix containing an <svg> element');
      }
      continue;
    }

    if (id === 'tiff') {
      // Reached only when no more specific TIFF-family signature matched, so this
      // is where DNG, NEF and ARW are separated from a genuine TIFF.
      if (matchesAnySignature(data, spec)) {
        const { format, reason } = resolveTiffFamily(data);
        return settle(format, 'deep', reason);
      }
      continue;
    }

    if (id === 'dng' || id === 'nef' || id === 'arw') {
      // These share the bare TIFF signature and are resolved by resolveTiffFamily.
      // Listing them before 'tiff' in DETECTION_ORDER would make them match every TIFF.
      continue;
    }

    if (matchesAnySignature(data, spec)) {
      const note = spec.signatures.find((s) => signatureMatches(data, s))?.note;
      return settle(id, 'signature', note ?? `${spec.label} signature matched`);
    }
  }

  // PDF readers tolerate leading junk before %PDF-, so a strict offset-0 test is not
  // enough for files produced by sloppy writers.
  const pdfAt = indexOfPattern(data, '%PDF-', 1024);
  if (pdfAt > 0) {
    return settle('pdf', 'deep', `PDF header found at offset ${pdfAt} after leading junk`);
  }

  return settle(
    null,
    'none',
    'No known signature matched the first bytes of this file. It may be corrupt, ' +
      'truncated, or a format this app does not support.',
  );
}

/**
 * A one-line description of what was detected, for diagnostics.
 *
 * Deliberately English and deliberately not in the catalogue: nothing renders this, and
 * nothing should. The `reason` strings it can return name byte offsets and container
 * tags, which are the right words for a bug report and the wrong ones for a person who
 * just wanted a JPEG. What the screen shows on a failed detection is
 * `common.unrecognised`.
 */
export function describeDetection(detection: Detection): string {
  if (!detection.format) return detection.reason;
  const spec = FORMATS[detection.format];
  if (!detection.extensionMismatch) return spec.label;
  const claimedLabel = detection.claimedFormat ? FORMATS[detection.claimedFormat].label : 'another';
  return `${spec.label} (named as ${claimedLabel})`;
}
