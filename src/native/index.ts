// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Typed wrappers over the TurboModules.
 *
 * Three jobs:
 *   1. Turn the codegen-friendly boundary types (`string`, `UnsafeObject`) back into
 *      the app's real types, so nothing downstream deals in loose strings.
 *   2. Validate anything going out, since codegen cannot check the nested structures.
 *   3. Fail with an actionable message when a module is missing, instead of the
 *      opaque error `getEnforcing` produces.
 */

import NativeFileGateway from './NativeFileGateway';
import NativeFormatDetector, { type DetectedFileSpec } from './NativeFormatDetector';
import NativeJobQueue from './NativeJobQueue';
import NativePdfEngine from './NativePdfEngine';
import NativeRasterCodec from './NativeRasterCodec';

import { buildOptions, type ConversionOptionsInput } from '@/engine/options';
import { ALL_FORMAT_IDS, type FormatId } from '@/engine/formats';
import type { ConversionResult, DetectedFile } from './types';

/* ------------------------------------------------------------------- linking ---- */

class NativeModuleUnavailableError extends Error {
  constructor(moduleName: string) {
    super(
      `The native module ${moduleName} is not linked into this build. ` +
        'Run `npm run prebuild && npm run ios` (or `npm run android`) to rebuild the ' +
        'native project. This app cannot run in Expo Go — it ships custom native code.',
    );
    this.name = 'NativeModuleUnavailableError';
  }
}

function require_<T>(module: T | null, name: string): NonNullable<T> {
  if (module == null) throw new NativeModuleUnavailableError(name);
  return module as NonNullable<T>;
}

/** True when every native module this build needs is present. */
export const isNativeAvailable = (): boolean =>
  NativeFormatDetector != null && NativeRasterCodec != null;

/* ------------------------------------------------------------------ narrowing ---- */

const FORMAT_IDS = new Set<string>(ALL_FORMAT_IDS);

const asFormatId = (value: string): FormatId | null =>
  FORMAT_IDS.has(value) ? (value as FormatId) : null;

const CONFIDENCES = new Set(['signature', 'deep', 'none']);

function normaliseDetection(raw: DetectedFileSpec): DetectedFile {
  return {
    ...raw,
    format: asFormatId(raw.format) ?? '',
    claimedFormat: asFormatId(raw.claimedFormat) ?? '',
    confidence: CONFIDENCES.has(raw.confidence) ? raw.confidence : 'none',
  } as DetectedFile;
}

/* ------------------------------------------------------------------- detector ---- */

export const formatDetector = {
  async detect(uri: string): Promise<DetectedFile> {
    const native = require_(NativeFormatDetector, 'NativeFormatDetector');
    return normaliseDetection(await native.detect(uri));
  },

  async detectMany(uris: string[]): Promise<DetectedFile[]> {
    const native = require_(NativeFormatDetector, 'NativeFormatDetector');
    return (await native.detectMany(uris)).map(normaliseDetection);
  },

  /** Used by the conformance test that proves native and JS detection agree. */
  async detectBase64(base64: string, filename: string): Promise<DetectedFile> {
    const native = require_(NativeFormatDetector, 'NativeFormatDetector');
    return normaliseDetection(await native.detectBase64(base64, filename));
  },

  async supportedFormats(): Promise<{
    decode: FormatId[];
    encode: FormatId[];
    pdfOperations: string[];
  }> {
    const native = require_(NativeFormatDetector, 'NativeFormatDetector');
    const raw = await native.supportedFormats();
    const keep = (list: string[]): FormatId[] =>
      list.map(asFormatId).filter((id): id is FormatId => id !== null);
    return {
      decode: keep(raw.decode),
      encode: keep(raw.encode),
      // Left as plain strings here; the store is what knows which operation names this
      // build has code paths for, and filters against that.
      pdfOperations: Array.isArray(raw.pdfOperations) ? raw.pdfOperations : [],
    };
  },
};

/* ---------------------------------------------------------------------- codec ---- */

export const rasterCodec = {
  /** Validates and applies defaults before anything crosses the boundary. */
  async convert(
    inputUri: string,
    outputUri: string,
    options: ConversionOptionsInput,
  ): Promise<ConversionResult> {
    const native = require_(NativeRasterCodec, 'NativeRasterCodec');
    return native.convert(inputUri, outputUri, buildOptions(options));
  },

  async estimateByteSize(inputUri: string, options: ConversionOptionsInput): Promise<number> {
    const native = require_(NativeRasterCodec, 'NativeRasterCodec');
    return native.estimateByteSize(inputUri, buildOptions(options));
  },

  async makePreview(inputUri: string, maxPixelSize: number): Promise<string> {
    const native = require_(NativeRasterCodec, 'NativeRasterCodec');
    return native.makePreview(inputUri, maxPixelSize);
  },

  cancelAll(): void {
    NativeRasterCodec?.cancelAll();
  },
};

/* -------------------------------------------------------------------- gateway ---- */

export const fileGateway = {
  async pickPhotos(limit = 0): Promise<DetectedFile[]> {
    const native = require_(NativeFileGateway, 'NativeFileGateway');
    const picked = (await native.pickPhotos(limit)) as unknown as DetectedFileSpec[];
    return picked.map(normaliseDetection);
  },

  async pickDocuments(utisOrMimeTypes: string[], allowMultiple = true): Promise<DetectedFile[]> {
    const native = require_(NativeFileGateway, 'NativeFileGateway');
    const picked = (await native.pickDocuments(
      utisOrMimeTypes,
      allowMultiple,
    )) as unknown as DetectedFileSpec[];
    return picked.map(normaliseDetection);
  },

  ensureLocal: (uri: string): Promise<string> =>
    require_(NativeFileGateway, 'NativeFileGateway').ensureLocal(uri),

  freeDiskSpace: (): Promise<number> =>
    require_(NativeFileGateway, 'NativeFileGateway').freeDiskSpace(),

  saveToPhotos: (uris: string[]): Promise<void> =>
    require_(NativeFileGateway, 'NativeFileGateway').saveToPhotos(uris),

  saveToDownloads: (uris: string[]): Promise<string[]> =>
    require_(NativeFileGateway, 'NativeFileGateway').saveToDownloads(uris),

  createZip: (uris: string[], zipName: string): Promise<string> =>
    require_(NativeFileGateway, 'NativeFileGateway').createZip(uris, zipName),

  sanitiseFilename: (name: string): string =>
    require_(NativeFileGateway, 'NativeFileGateway').sanitiseFilename(name),

  resolveCollision: (directory: string, filename: string): Promise<string> =>
    require_(NativeFileGateway, 'NativeFileGateway').resolveCollision(directory, filename),

  clearTemporaryFiles: (): Promise<void> =>
    require_(NativeFileGateway, 'NativeFileGateway').clearTemporaryFiles(),
};

/* ---------------------------------------------------------- queue and PDF (P2/P3) -- */

export const jobQueue = NativeJobQueue;
export const pdfEngine = NativePdfEngine;

export type { DetectedFile, ConversionResult } from './types';
