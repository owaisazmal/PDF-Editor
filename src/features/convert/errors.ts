// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { ConversionErrorCode } from '@/native/types';

/**
 * Turns a native failure code into a catalogue key.
 *
 * Keys rather than sentences, because this is reached from three screens and from a
 * plain module, and none of them can hand it a `t`. Every message it points at says what
 * went wrong and what to do next; none of them apologise, and none show a stack trace or
 * an error number — those go to the console, where they are useful, not to the screen,
 * where they are noise.
 */
export type ErrorKey = `errors.${string}`;

const KEYS: Record<string, ErrorKey> = {
  [ConversionErrorCode.UNREADABLE]: 'errors.unreadable',
  [ConversionErrorCode.UNSUPPORTED_SOURCE]: 'errors.unsupportedSource',
  [ConversionErrorCode.UNSUPPORTED_TARGET]: 'errors.unsupportedTarget',
  [ConversionErrorCode.CORRUPT]: 'errors.corrupt',
  [ConversionErrorCode.OUT_OF_MEMORY]: 'errors.outOfMemory',
  [ConversionErrorCode.DISK_FULL]: 'errors.diskFull',
  [ConversionErrorCode.PERMISSION_DENIED]: 'errors.permissionDenied',
  [ConversionErrorCode.PASSWORD_REQUIRED]: 'errors.passwordRequired',
  [ConversionErrorCode.WRONG_PASSWORD]: 'errors.wrongPassword',
  [ConversionErrorCode.DOWNLOAD_FAILED]: 'errors.downloadFailed',
  [ConversionErrorCode.CANCELLED]: 'errors.cancelled',
  [ConversionErrorCode.UNKNOWN]: 'errors.unknown',
};

export function errorKey(code: string): ErrorKey {
  return KEYS[code] ?? 'errors.unknown';
}

/**
 * The key for a rejected native call.
 *
 * A TurboModule rejection arrives as an `Error` carrying the code it was rejected with,
 * so the right message is available. Anything else — a zod validation failure, a message
 * thrown from Swift or Kotlin, a missing native module — has a `message` written for
 * whoever is reading the console, in English, and it stays there: the engine's own
 * sentences are not in the catalogue and never will be, so showing one puts a hard
 * English string on a Japanese screen. The generic message is the honest thing to show
 * and the raw text still reaches the log.
 */
export function errorKeyFor(error: unknown): ErrorKey {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === 'string' && code in KEYS) return errorKey(code);

  if (error instanceof Error && error.message.length > 0) {
    // Logged rather than shown: the detail belongs where a developer reads it.
    console.warn('[converter] untranslated failure:', error.message);
  }
  return 'errors.unknown';
}
