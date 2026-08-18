// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
import type { EventEmitter, UnsafeObject } from 'react-native/Libraries/Types/CodegenTypes';

/**
 * Everything that touches the filesystem or the system pickers.
 *
 * This module exists partly to avoid `expo-image-picker`: on iOS that library can hand
 * back a transcoded JPEG instead of the original HEIC, which would silently break the
 * app's headline conversion — the user would "convert" a file the OS already converted.
 * Here, `pickPhotos` configures `PHPickerViewController` to request the original file
 * representation and its exact UTI.
 *
 * Neither picker requires a runtime permission: `PHPickerViewController` on iOS and the
 * Photo Picker on Android both run out of process. Saving to Photos on iOS needs only
 * add-only access.
 */
export interface Spec extends TurboModule {
  /**
   * System photo picker. Returns original files, never transcoded ones.
   * `limit` of 0 means unlimited.
   */
  pickPhotos(limit: number): Promise<UnsafeObject[]>;

  /**
   * System document picker — Files on iOS, Storage Access Framework on Android.
   * `utisOrMimeTypes` filters what is selectable.
   */
  pickDocuments(utisOrMimeTypes: string[], allowMultiple: boolean): Promise<UnsafeObject[]>;

  /**
   * Materialises a file that lives in iCloud or Google Drive but is not on disk yet.
   * Resolves once the local copy is complete. Progress arrives on `onProgress`.
   */
  ensureLocal(uri: string): Promise<string>;

  /** Free space in bytes on the volume that holds the output directory. */
  freeDiskSpace(): Promise<number>;

  /**
   * Writes converted images to the photo library. iOS needs add-only access, which is
   * the least privileged option available and never grants read access.
   */
  saveToPhotos(uris: string[]): Promise<void>;

  /** Saves to Files on iOS or Downloads via MediaStore on Android. */
  saveToDownloads(uris: string[]): Promise<string[]>;

  /** Bundles outputs into a ZIP. Uses `java.util.zip` and `Compression` — no dependency. */
  createZip(uris: string[], zipName: string): Promise<string>;

  /**
   * Makes a filename safe for the destination filesystem without mangling it: emoji and
   * right-to-left text survive, length is capped below the 255-byte limit by trimming
   * on a grapheme boundary, and reserved characters are replaced rather than dropped.
   */
  sanitiseFilename(name: string): string;

  /**
   * Resolves a collision by appending ` (1)`, ` (2)` and so on. Never overwrites.
   * Returns the path that is safe to write.
   */
  resolveCollision(directory: string, filename: string): Promise<string>;

  /** Deletes the app's temporary working directory. Safe to call at any time. */
  clearTemporaryFiles(): Promise<void>;

  /* ------------------------------------------------------------ incoming ---- */

  /**
   * Files handed to the app from outside it — a share, an Open With, or a drop.
   *
   * Emitted when they arrive at a running app. A cold start does not get this event,
   * because the files were already waiting before JavaScript existed; that case is what
   * {@link takePendingFiles} is for.
   */
  readonly onFilesReceived: EventEmitter<UnsafeObject>;

  /**
   * Takes whatever arrived before JavaScript was listening, and empties the queue.
   *
   * A cold start from a share sheet is the normal case rather than the exception, so the
   * files have to survive between the intent arriving and the UI being ready to show
   * them. Taking rather than reading means a reload cannot resurrect a share the user
   * already dealt with.
   */
  takePendingFiles(): Promise<UnsafeObject[]>;
}

// `get` rather than `getEnforcing`: importing a spec must not throw in Jest or on a
// build where this module is not yet linked. The wrapper in `index.ts` raises a
// specific, actionable error at call time instead.
export default TurboModuleRegistry.get<Spec>('NativeFileGateway');
