// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.core

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap

/**
 * What the detector knows about a file after reading its header.
 *
 * Field names and types match `DetectedFileSpec` in
 * `src/native/NativeFormatDetector.ts` and `DetectedFile.swift` exactly — all three
 * describe the same payload, and `toWritableMap` is what actually crosses the bridge.
 */
public data class DetectedFile(
  var uri: String = "",
  var displayName: String = "",
  /** A format id from the generated table, or "" when unidentified. Not an error. */
  var format: String = "",
  var confidence: String = "none",
  var reason: String = "",
  var claimedFormat: String = "",
  var byteSize: Long = 0,
  var pixelWidth: Int = 0,
  var pixelHeight: Int = 0,
  /** EXIF orientation, 1-8. Zero when absent. */
  var exifOrientation: Int = 0,
  var hasAlpha: Boolean = false,
  var isAnimated: Boolean = false,
  var frameCount: Int = 1,
  var colorSpace: String = "",
  var bitDepth: Int = 8,
  var hasGpsMetadata: Boolean = false,
  var pageCount: Int = 0,
  var isEncrypted: Boolean = false,
  var needsDownload: Boolean = false,
) {
  public fun toWritableMap(): WritableMap = Arguments.createMap().apply {
    putString("uri", uri)
    putString("displayName", displayName)
    putString("format", format)
    putString("confidence", confidence)
    putString("reason", reason)
    putString("claimedFormat", claimedFormat)
    // JavaScript numbers are doubles; a file size is far inside the safe integer
    // range, so this is exact rather than approximate.
    putDouble("byteSize", byteSize.toDouble())
    putInt("pixelWidth", pixelWidth)
    putInt("pixelHeight", pixelHeight)
    putInt("exifOrientation", exifOrientation)
    putBoolean("hasAlpha", hasAlpha)
    putBoolean("isAnimated", isAnimated)
    putInt("frameCount", frameCount)
    putString("colorSpace", colorSpace)
    putInt("bitDepth", bitDepth)
    putBoolean("hasGpsMetadata", hasGpsMetadata)
    putInt("pageCount", pageCount)
    putBoolean("isEncrypted", isEncrypted)
    putBoolean("needsDownload", needsDownload)
  }
}
