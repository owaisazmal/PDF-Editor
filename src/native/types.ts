// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The shapes that cross the TurboModule boundary.
 *
 * Two rules hold everywhere in this file:
 *
 *   1. No pixel data crosses. Images are referred to by path or by an opaque handle;
 *      the bytes stay in native memory for their whole life.
 *   2. Everything is JSON-serialisable. React Native codegen supports a narrow type
 *      vocabulary, so unions are declared as `string` at the boundary and narrowed by
 *      the typed wrappers in `src/native/index.ts` before the rest of the app sees them.
 */

import type { DetectionConfidence } from '@/engine/detect';
import type { FormatId } from '@/engine/formats';

/* --------------------------------------------------------------- detection ---- */

export type DetectedFile = {
  /** Absolute file path or content URI, exactly as it must be handed back to native. */
  uri: string;
  /** Display name, already sanitised for the target filesystem. */
  displayName: string;
  /** Empty when the file could not be identified — the batch continues past it. */
  format: FormatId | '';
  confidence: DetectionConfidence;
  /** Why the detector reached this conclusion. Shown verbatim in error states. */
  reason: string;
  /** Empty when the filename claimed nothing recognisable. */
  claimedFormat: FormatId | '';
  byteSize: number;
  pixelWidth: number;
  pixelHeight: number;
  /** EXIF orientation tag, 1-8. 0 when absent. */
  exifOrientation: number;
  hasAlpha: boolean;
  isAnimated: boolean;
  /** 1 for stills. */
  frameCount: number;
  /** e.g. 'sRGB', 'Display P3', 'CMYK'. Empty when undetermined. */
  colorSpace: string;
  /** Bits per channel. 8 for most images, 16 for deep PNG and TIFF. */
  bitDepth: number;
  hasGpsMetadata: boolean;
  /** PDF only. 0 otherwise. */
  pageCount: number;
  /** PDF only. */
  isEncrypted: boolean;
  /** True when the file lives in iCloud or Drive and has not been downloaded yet. */
  needsDownload: boolean;
};

/* -------------------------------------------------------------- conversion ---- */

/** How to treat transparency when the destination format has no alpha channel. */
export type BackgroundFill = {
  /** '#RRGGBB'. Defaults to white; black backgrounds are the top one-star complaint. */
  color: string;
};

export type ResizeSpec = {
  /** 'none' | 'percent' | 'maxDimension' | 'exact'. */
  mode: string;
  percent: number;
  maxWidth: number;
  maxHeight: number;
  exactWidth: number;
  exactHeight: number;
  /** Never scale a smaller image up to meet the target. */
  allowUpscale: boolean;
};

export type MetadataPolicy = {
  /** 'stripAll' | 'keepAll' | 'keepExceptGps'. Default is 'keepExceptGps'. */
  mode: string;
};

export type ConversionOptions = {
  /** Destination {@link import('../engine/formats').FormatId}. */
  targetFormat: string;
  /** 1-100 for lossy formats. Ignored for lossless ones. */
  quality: number;
  /**
   * When > 0, native binary-searches quality to land under this many bytes and
   * ignores `quality`. Reports the quality it settled on in the result.
   */
  targetByteSize: number;
  resize: ResizeSpec;
  /** Degrees clockwise: 0, 90, 180 or 270. Applied after orientation is baked in. */
  rotate: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  metadata: MetadataPolicy;
  /** Convert Display P3 to sRGB. On by default — P3 JPEGs look wrong in many apps. */
  convertToSrgb: boolean;
  background: BackgroundFill;
  /** Encode WebP losslessly. Ignored for other formats. */
  lossless: boolean;
  /** For animated sources converted to a still format: which frame to keep. */
  frameIndex: number;
};

export type ConversionResult = {
  /**
   * The file's position in what the user picked. Set by the job queue; -1 for a
   * single-file conversion, which has no selection to be positioned within.
   *
   * The queue is concurrent, so completion order is arbitrary. Presenting results in
   * that order means a list that reshuffles as it fills, which reads as instability
   * rather than progress.
   */
  sourceIndex: number;
  outputUri: string;
  outputDisplayName: string;
  format: string;
  byteSize: number;
  pixelWidth: number;
  pixelHeight: number;
  /** The quality actually used, which differs from the request in target-size mode. */
  qualityUsed: number;
  /** Wall-clock milliseconds spent in native code. */
  elapsedMs: number;
};

/* ------------------------------------------------------------------- errors ---- */

/**
 * Stable, machine-readable failure reasons. The UI maps these to localised strings;
 * `message` is a developer-facing fallback and is never shown untranslated.
 */
export const ConversionErrorCode = {
  UNREADABLE: 'unreadable',
  UNSUPPORTED_SOURCE: 'unsupportedSource',
  UNSUPPORTED_TARGET: 'unsupportedTarget',
  CORRUPT: 'corrupt',
  OUT_OF_MEMORY: 'outOfMemory',
  DISK_FULL: 'diskFull',
  PERMISSION_DENIED: 'permissionDenied',
  PASSWORD_REQUIRED: 'passwordRequired',
  WRONG_PASSWORD: 'wrongPassword',
  DOWNLOAD_FAILED: 'downloadFailed',
  CANCELLED: 'cancelled',
  UNKNOWN: 'unknown',
} as const;

export type ConversionErrorCodeValue =
  (typeof ConversionErrorCode)[keyof typeof ConversionErrorCode];

export type FileFailure = {
  /** The file's position in what the user picked. See ConversionResult.sourceIndex. */
  sourceIndex: number;
  uri: string;
  displayName: string;
  /** One of {@link ConversionErrorCode}. */
  code: string;
  message: string;
};

/* -------------------------------------------------------------------- queue ---- */

export type JobSpec = {
  /** Caller-generated so JS can correlate before native replies. */
  jobId: string;
  inputUris: string[];
  options: ConversionOptions;
  /** Directory to write into. Empty means the app's managed output directory. */
  outputDirectory: string;
  /**
   * Rename pattern with `{name}`, `{index}`, `{date}`, `{format}` tokens.
   * Empty means keep the source name with a new extension.
   */
  namePattern: string;
  /**
   * 0 lets native size the queue from the CPU count and the device RAM class.
   * Any other value is a hard cap, used by tests.
   */
  maxConcurrency: number;
  /** Keep working when the app is backgrounded. */
  continueInBackground: boolean;
};

export type JobProgress = {
  jobId: string;
  completedCount: number;
  failedCount: number;
  totalCount: number;
  /** 0-1 across the whole job, weighted by input byte size rather than file count. */
  fraction: number;
  /** The file currently being worked on, for the progress label. */
  currentDisplayName: string;
};

/**
 * Statuses the native queue can report.
 *
 * Declared here rather than in the client because it is a domain fact, not a transport
 * detail — and because typing `status` as a bare `string` pushes the narrowing burden
 * onto every screen that renders it.
 */
export const JOB_STATUSES = [
  'queued',
  'running',
  'cancelling',
  'completed',
  'cancelled',
  'failed',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobState = {
  jobId: string;
  status: JobStatus;
  progress: JobProgress;
  results: ConversionResult[];
  failures: FileFailure[];
};
