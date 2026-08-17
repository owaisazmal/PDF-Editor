// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
import type { UnsafeObject } from 'react-native/Libraries/Types/CodegenTypes';

/**
 * PDF in both directions, plus the page utilities.
 *
 * Implemented in Phase 3; the spec is declared now so the capability matrix and the
 * planner can be written against a stable surface.
 *
 * Two platform notes that shape this interface:
 *
 *   - Android's `PdfRenderer` has no password API and throws on an encrypted file, so
 *     `unlock` is implemented against the ISO 32000-2 standard security handler over
 *     `javax.crypto`. iOS gets it free from `PDFDocument.unlock(withPassword:)`.
 *     A password is held in memory for the lifetime of the operation and never persisted.
 *   - Neither platform can rewrite an embedded image stream in place, so `compress`
 *     rasterises and re-encodes. That flattens selectable text, which the UI warns about
 *     before applying rather than discovering afterwards.
 */
export interface Spec extends TurboModule {
  /** Page count, page sizes, and whether a password is required. */
  inspect(uri: string): Promise<UnsafeObject>;

  /**
   * Verifies a password and returns an opaque session handle. The password itself never
   * leaves native memory and is never written to disk, MMKV, or the history store.
   */
  unlock(uri: string, password: string): Promise<string>;

  /** Renders pages to image files at a chosen DPI. Streams page by page. */
  renderPages(uri: string, sessionHandle: string, options: UnsafeObject): Promise<UnsafeObject>;

  /** Composes images into a PDF with page geometry, fit mode, margins and N-up. */
  composeFromImages(imageUris: string[], outputUri: string, options: UnsafeObject): Promise<UnsafeObject>;

  merge(uris: string[], outputUri: string): Promise<UnsafeObject>;

  /** Splits by explicit ranges, or every N pages when `ranges` is empty. */
  split(uri: string, outputDirectory: string, options: UnsafeObject): Promise<UnsafeObject>;

  /** Deletes, rotates and reorders pages in one pass. */
  editPages(uri: string, outputUri: string, operations: UnsafeObject): Promise<UnsafeObject>;

  /** Rasterises and re-encodes at the given DPI and quality. See the note above. */
  compress(uri: string, outputUri: string, options: UnsafeObject): Promise<UnsafeObject>;

  /** Discards an unlock session and zeroes the retained key material. */
  closeSession(sessionHandle: string): void;
}

// `get` rather than `getEnforcing`: importing a spec must not throw in Jest or on a
// build where this module is not yet linked. The wrapper in `index.ts` raises a
// specific, actionable error at call time instead.
export default TurboModuleRegistry.get<Spec>('NativePdfEngine');
