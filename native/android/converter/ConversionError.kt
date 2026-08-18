// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.core

/**
 * Failures a user can be told about.
 *
 * `code` matches `ConversionErrorCode` in `src/native/types.ts` and the Swift
 * `ConversionError`, so one JavaScript switch handles both platforms. The message is
 * developer-facing; the UI resolves a translated string from the code.
 *
 * Thrown per file and collected, never propagated out of a batch — one bad file must
 * not end the job.
 */
public class ConversionException(
  public val code: String,
  message: String,
) : Exception(message) {

  public companion object {
    public fun unreadable(name: String): ConversionException =
      ConversionException("unreadable", "Could not open $name.")

    public fun unsupportedSource(format: String): ConversionException =
      ConversionException("unsupportedSource", "Cannot read $format on this device.")

    public fun unsupportedTarget(format: String): ConversionException =
      ConversionException("unsupportedTarget", "Cannot write $format on this device.")

    public fun corrupt(name: String): ConversionException =
      ConversionException("corrupt", "$name is damaged or incomplete.")

    public fun outOfMemory(): ConversionException =
      ConversionException("outOfMemory", "Not enough memory to process this image.")

    public fun diskFull(): ConversionException =
      ConversionException("diskFull", "Not enough free space to write the result.")

    public fun permissionDenied(): ConversionException =
      ConversionException("permissionDenied", "Permission to save was denied.")

    public fun passwordRequired(): ConversionException =
      ConversionException("passwordRequired", "This PDF needs a password to open.")

    public fun wrongPassword(): ConversionException =
      ConversionException("wrongPassword", "That password did not open the PDF.")

    public fun cancelled(): ConversionException =
      ConversionException("cancelled", "Cancelled.")
  }
}
