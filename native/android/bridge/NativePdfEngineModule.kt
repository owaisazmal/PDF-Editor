// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.bridge

import android.net.Uri
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule
import com.owaiskhan.converter.NativePdfEngineSpec
import com.owaiskhan.converter.core.FileGateway
import com.owaiskhan.converter.core.PdfEngine
import java.io.File
import java.util.concurrent.Executors

/**
 * TurboModule surface for the PDF engine. Pure forwarding — every decision lives in
 * `PdfEngine`, which is testable without React Native in the loop.
 *
 * A single-threaded executor rather than a pool: `PdfRenderer` permits one open page at
 * a time per document, and rendering two 300 DPI pages at once is how a mid-range phone
 * runs out of heap in the middle of a 400-page export.
 */
@ReactModule(name = NativePdfEngineModule.NAME)
public class NativePdfEngineModule(
  reactContext: ReactApplicationContext,
) : NativePdfEngineSpec(reactContext) {

  public companion object {
    public const val NAME: String = "NativePdfEngine"
  }

  private val executor = Executors.newSingleThreadExecutor()

  override fun inspect(uri: String, promise: Promise) {
    executor.execute {
      runCatching { PdfEngine.inspect(reactApplicationContext, resolve(uri)) }
        .onSuccess(promise::resolve)
        .onFailure { promise.rejectConversion(it) }
    }
  }

  override fun unlock(uri: String, password: String, promise: Promise) {
    executor.execute {
      runCatching { PdfEngine.unlock(reactApplicationContext, resolve(uri), password) }
        .onSuccess(promise::resolve)
        .onFailure { promise.rejectConversion(it) }
    }
  }

  override fun renderPages(
    uri: String,
    sessionHandle: String,
    options: ReadableMap,
    promise: Promise,
  ) {
    val parsed = PdfEngine.RenderOptions.from(options)
    executor.execute {
      runCatching {
        PdfEngine.renderPages(reactApplicationContext, resolve(uri), sessionHandle, parsed)
      }
        .onSuccess(promise::resolve)
        .onFailure { promise.rejectConversion(it) }
    }
  }

  override fun composeFromImages(
    imageUris: ReadableArray,
    outputUri: String,
    options: ReadableMap,
    promise: Promise,
  ) {
    val inputs = imageUris.toStringList()
    val parsed = PdfEngine.ComposeOptions.from(options)
    executor.execute {
      runCatching {
        PdfEngine.composeFromImages(
          images = inputs.map { resolve(it) },
          output = output(outputUri, "document"),
          options = parsed,
        )
      }
        .onSuccess(promise::resolve)
        .onFailure { promise.rejectConversion(it) }
    }
  }

  override fun merge(uris: ReadableArray, outputUri: String, promise: Promise) {
    val inputs = uris.toStringList()
    executor.execute {
      runCatching {
        PdfEngine.merge(reactApplicationContext, inputs.map { resolve(it) }, output(outputUri, "merged"))
      }
        .onSuccess(promise::resolve)
        .onFailure { promise.rejectConversion(it) }
    }
  }

  override fun split(uri: String, outputDirectory: String, options: ReadableMap, promise: Promise) {
    executor.execute {
      runCatching {
        PdfEngine.split(
          context = reactApplicationContext,
          file = resolve(uri),
          outputDirectory = if (outputDirectory.isEmpty()) {
            FileGateway.outputDirectory(reactApplicationContext)
          } else {
            FileGateway.fileFromUri(outputDirectory)
          },
          options = options,
        )
      }
        .onSuccess(promise::resolve)
        .onFailure { promise.rejectConversion(it) }
    }
  }

  override fun editPages(
    uri: String,
    outputUri: String,
    operations: ReadableMap,
    promise: Promise,
  ) {
    executor.execute {
      runCatching {
        PdfEngine.editPages(
          reactApplicationContext,
          resolve(uri),
          output(outputUri, "edited"),
          operations,
        )
      }
        .onSuccess(promise::resolve)
        .onFailure { promise.rejectConversion(it) }
    }
  }

  override fun compress(uri: String, outputUri: String, options: ReadableMap, promise: Promise) {
    val parsed = PdfEngine.CompressOptions.from(options)
    executor.execute {
      runCatching {
        PdfEngine.compress(resolve(uri), output(outputUri, "compressed"), "", parsed)
      }
        .onSuccess(promise::resolve)
        .onFailure { promise.rejectConversion(it) }
    }
  }

  override fun closeSession(sessionHandle: String) {
    PdfEngine.closeSession(sessionHandle)
  }

  override fun invalidate() {
    executor.shutdownNow()
    super.invalidate()
  }

  /** A content:// URI is materialised into the app's own storage before it is opened. */
  private fun resolve(uri: String): File =
    if (uri.startsWith("content://")) {
      FileGateway.materialise(reactApplicationContext, Uri.parse(uri))
    } else {
      FileGateway.fileFromUri(uri)
    }

  /**
   * An empty output URI means "choose a path in the managed output directory", which
   * keeps the filesystem entirely native — JavaScript never has to know where the app's
   * storage lives, and the chosen path comes back in the result.
   */
  private fun output(uri: String, fallbackName: String): File =
    if (uri.isNotEmpty()) {
      FileGateway.fileFromUri(uri)
    } else {
      FileGateway.resolveCollision(
        FileGateway.outputDirectory(reactApplicationContext),
        "$fallbackName.pdf",
      )
    }
}

private fun ReadableArray.toStringList(): List<String> =
  (0 until size()).mapNotNull { getString(it) }
