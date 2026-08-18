// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.core

import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap

/**
 * What this device can actually read and write.
 *
 * Unlike iOS, Android has no query API for codec support, so this is a version table —
 * the one place in the codebase where an OS version check is the honest answer rather
 * than a shortcut. The engine builds its conversion matrix from this at startup, so a
 * format the device cannot handle is disabled in the UI instead of failing at the end
 * of a batch.
 *
 * The gaps are real and documented in docs/ARCHITECTURE.md §3: Android has no encoder
 * for AVIF, TIFF, BMP, ICO, animated GIF or animated WebP, and no RAW support beyond
 * DNG on devices whose vendor provides it.
 */
public object Capabilities {

  public fun current(): WritableMap {
    val sdk = Build.VERSION.SDK_INT

    val decode = buildList {
      // Supported on every API level this app targets.
      addAll(listOf("jpeg", "png", "gif", "bmp", "webp"))

      // HEIF and HEIC decoding arrived with ImageDecoder in API 28. Below that the
      // headline conversion is simply unavailable, and the UI says so rather than
      // failing at conversion time.
      if (sdk >= Build.VERSION_CODES.P) addAll(listOf("heic", "heif"))

      // AVIF decoding arrived in API 31.
      if (sdk >= Build.VERSION_CODES.S) add("avif")

      // DNG decodes only where the vendor supports it, so it is offered and allowed to
      // fail per file rather than being promised. CR2, NEF and ARW are not deliverable
      // on Android at all: every permissive decoder is copyleft.
      add("dng")

      // PDF via PdfRenderer, and SVG via androidsvg. Both are import-only here.
      addAll(listOf("pdf", "svg"))
    }

    val encode = buildList {
      // Bitmap.compress covers exactly these three.
      addAll(listOf("jpeg", "png", "webp"))
      // PdfDocument can compose a PDF from images.
      add("pdf")
    }

    val pdfOperations = buildList {
      // PdfRenderer reads and PdfDocument writes, which covers everything that can be
      // expressed as painting pages.
      addAll(listOf("inspect", "render", "compose", "compress"))

      // Merge, split and page editing need to copy a page object from one document into
      // another, and no Android API exposes one. Reported closed rather than
      // implemented by rasterising — see PdfEngine.kt.

      // A password API for PdfRenderer arrived in Android 15.
      if (sdk >= Build.VERSION_CODES.VANILLA_ICE_CREAM) add("unlock")
    }

    return Arguments.createMap().apply {
      putArray("decode", Arguments.fromList(decode.sorted()))
      putArray("encode", Arguments.fromList(encode.sorted()))
      putArray("pdfOperations", Arguments.fromList(pdfOperations.sorted()))
    }
  }
}
