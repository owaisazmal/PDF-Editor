// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { ConversionErrorCode } from '@/native/types';

/**
 * Turns a native failure code into something a person can act on.
 *
 * Every message says what went wrong and what to do next. None of them apologise, and
 * none of them show a stack trace or an error number — those go to the console, where
 * they are useful, not to the screen, where they are noise.
 *
 * These strings move into `src/i18n` in Phase 5. They live here as English literals
 * until then so the translation keys can be extracted from real, settled copy rather
 * than from placeholders.
 */
const MESSAGES: Record<string, string> = {
  [ConversionErrorCode.UNREADABLE]:
    'This file could not be opened. It may have been moved or deleted since you picked it.',
  [ConversionErrorCode.UNSUPPORTED_SOURCE]:
    'This format is not supported on this device. Older Android versions cannot read HEIC.',
  [ConversionErrorCode.UNSUPPORTED_TARGET]:
    'This device cannot write that format. Choose a different output format.',
  [ConversionErrorCode.CORRUPT]:
    'This file is damaged or incomplete, so it cannot be read. Try downloading it again.',
  [ConversionErrorCode.OUT_OF_MEMORY]:
    'This image is too large to process right now. Close other apps and try again.',
  [ConversionErrorCode.DISK_FULL]:
    'There is not enough free space to save the result. Free up some space and try again.',
  [ConversionErrorCode.PERMISSION_DENIED]:
    'Saving needs permission to add photos. You can grant it in Settings.',
  [ConversionErrorCode.PASSWORD_REQUIRED]: 'This PDF is password protected. Enter its password to continue.',
  [ConversionErrorCode.WRONG_PASSWORD]: 'That password did not work. Check it and try again.',
  [ConversionErrorCode.DOWNLOAD_FAILED]:
    'This file is stored in the cloud and could not be downloaded. Check your connection and try again.',
  [ConversionErrorCode.CANCELLED]: 'Conversion cancelled.',
  [ConversionErrorCode.UNKNOWN]: 'Something went wrong converting this file. Try again.',
};

export function errorMessage(code: string): string {
  return MESSAGES[code] ?? MESSAGES[ConversionErrorCode.UNKNOWN]!;
}

/**
 * The message for a rejected native call.
 *
 * A TurboModule rejection arrives as an `Error` carrying the code it was rejected with,
 * so the translated message above is available. A JavaScript error thrown before the
 * call ever crossed has no code, and its own message — a zod validation failure, say —
 * is the more useful thing to show than a generic apology.
 */
export function errorMessageFor(error: unknown): string {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === 'string' && code in MESSAGES) return errorMessage(code);
  if (error instanceof Error && error.message.length > 0) return error.message;
  return errorMessage(ConversionErrorCode.UNKNOWN);
}
