// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.bridge

import android.net.Uri
import com.owaiskhan.converter.NativeRasterCodecSpec
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule
import com.owaiskhan.converter.core.FileGateway
import com.owaiskhan.converter.core.RasterCodec
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

/**
 * TurboModule surface for single-file conversion.
 *
 * Batches do not come through here — from Phase 2 the native job queue calls
 * `RasterCodec` directly, so a 500-file job makes one bridge call rather than five
 * hundred.
 */
@ReactModule(name = NativeRasterCodecModule.NAME)
public class NativeRasterCodecModule(
  reactContext: ReactApplicationContext,
) : NativeRasterCodecSpec(reactContext) {

  public companion object {
    public const val NAME: String = "NativeRasterCodec"
  }

  private val executor = Executors.newFixedThreadPool(
    Runtime.getRuntime().availableProcessors().coerceIn(2, 6),
  )

  override fun convert(inputUri: String, outputUri: String, options: ReadableMap, promise: Promise) {
    val parsed = RasterCodec.Options.from(options)
    executor.execute {
      runCatching {
        RasterCodec.convert(
          input = resolve(inputUri),
          // An empty outputUri means "choose a path in the managed directory", so the
          // filesystem stays entirely native.
          requestedOutput = outputUri.takeIf { it.isNotEmpty() }?.let { resolve(it) },
          outputDirectory = FileGateway.outputDirectory(reactApplicationContext),
          options = parsed,
        ).toWritableMap()
      }
        .onSuccess(promise::resolve)
        .onFailure { promise.rejectConversion(it) }
    }
  }

  override fun estimateByteSize(inputUri: String, options: ReadableMap, promise: Promise) {
    val parsed = RasterCodec.Options.from(options)
    executor.execute {
      runCatching {
        val scratch = File(
          FileGateway.temporaryDirectory(reactApplicationContext),
          "estimate-${UUID.randomUUID()}",
        )
        try {
          RasterCodec.convert(
            input = resolve(inputUri),
            requestedOutput = scratch,
            outputDirectory = FileGateway.outputDirectory(reactApplicationContext),
            options = parsed,
          ).byteSize.toDouble()
        } finally {
          scratch.delete()
        }
      }
        .onSuccess(promise::resolve)
        .onFailure { promise.rejectConversion(it) }
    }
  }

  override fun makePreview(inputUri: String, maxPixelSize: Double, promise: Promise) {
    executor.execute {
      runCatching {
        val destination = File(
          FileGateway.temporaryDirectory(reactApplicationContext),
          "preview-${UUID.randomUUID()}.jpg",
        )
        RasterCodec.convert(
          input = resolve(inputUri),
          requestedOutput = destination,
          outputDirectory = FileGateway.outputDirectory(reactApplicationContext),
          options = RasterCodec.Options(
            targetFormat = "jpeg",
            quality = 80,
            resizeMode = "maxDimension",
            maxWidth = maxPixelSize.toInt(),
            maxHeight = maxPixelSize.toInt(),
            metadataMode = "stripAll",
          ),
        ).let { FileGateway.fileUri(it.outputFile) }
      }
        .onSuccess(promise::resolve)
        .onFailure { promise.rejectConversion(it) }
    }
  }

  private fun resolve(uri: String): File =
    if (uri.startsWith("content://")) {
      FileGateway.materialise(reactApplicationContext, Uri.parse(uri))
    } else {
      FileGateway.fileFromUri(uri)
    }

  override fun invalidate() {
    executor.shutdownNow()
    super.invalidate()
  }
}
