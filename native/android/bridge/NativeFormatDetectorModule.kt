// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.bridge

import android.net.Uri
import com.owaiskhan.converter.NativeFormatDetectorSpec
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.annotations.ReactModule
import com.owaiskhan.converter.core.Capabilities
import com.owaiskhan.converter.core.ConversionException
import com.owaiskhan.converter.core.DetectedFile
import com.owaiskhan.converter.core.FileGateway
import com.owaiskhan.converter.core.FormatDetector
import java.io.File
import java.util.concurrent.Executors

/**
 * TurboModule surface for format detection. Pure forwarding — every decision lives in
 * `FormatDetector`, which is testable without React Native in the loop.
 */
@ReactModule(name = NativeFormatDetectorModule.NAME)
public class NativeFormatDetectorModule(
  reactContext: ReactApplicationContext,
) : NativeFormatDetectorSpec(reactContext) {

  public companion object {
    public const val NAME: String = "NativeFormatDetector"
  }

  // Detection is header-only and cheap, but it is still I/O and never belongs on the
  // JS thread. Sized to the cores because a 500-file selection benefits from them.
  private val executor = Executors.newFixedThreadPool(
    Runtime.getRuntime().availableProcessors().coerceIn(2, 8),
  )

  override fun detect(uri: String, promise: Promise) {
    executor.execute {
      runCatching { FormatDetector.detect(resolve(uri)).toWritableMap() }
        .onSuccess(promise::resolve)
        .onFailure { promise.rejectConversion(it) }
    }
  }

  override fun detectMany(uris: ReadableArray, promise: Promise) {
    executor.execute {
      runCatching {
        val results = Arguments.createArray()
        for (index in 0 until uris.size()) {
          val uri = uris.getString(index) ?: continue
          // A file that cannot be opened still gets an entry, so the caller can report
          // it rather than silently receiving a shorter list.
          val detected = runCatching { FormatDetector.detect(resolve(uri)) }
            .getOrElse { placeholder(uri) }
          results.pushMap(detected.toWritableMap())
        }
        results
      }
        .onSuccess(promise::resolve)
        .onFailure { promise.rejectConversion(it) }
    }
  }

  override fun detectBase64(base64: String, filename: String, promise: Promise) {
    executor.execute {
      runCatching {
        val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
        FormatDetector.detect(bytes, filename).toWritableMap()
      }
        .onSuccess(promise::resolve)
        .onFailure { promise.rejectConversion(it) }
    }
  }

  override fun supportedFormats(promise: Promise) {
    promise.resolve(Capabilities.current())
  }

  /** Accepts `file://`, `content://` and bare paths, which arrive from different places. */
  private fun resolve(uri: String): File =
    if (uri.startsWith("content://")) {
      FileGateway.materialise(reactApplicationContext, Uri.parse(uri))
    } else {
      FileGateway.fileFromUri(uri)
    }

  private fun placeholder(uri: String) = DetectedFile(
    uri = uri,
    displayName = uri.substringAfterLast('/'),
    reason = "This file could not be opened.",
  )

  override fun invalidate() {
    executor.shutdownNow()
    super.invalidate()
  }
}

/** Maps our error codes across the bridge so the UI can show a translated message. */
internal fun Promise.rejectConversion(error: Throwable) {
  val code = (error as? ConversionException)?.code ?: "unknown"
  reject(code, error.message ?: code, error)
}
