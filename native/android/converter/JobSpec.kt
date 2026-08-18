// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.core

import android.content.Context
import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * A batch of work, described declaratively.
 *
 * Everything the queue needs is decided here, before any file is touched: how many
 * conversions may run at once, where each output goes, and what it is called. Deciding
 * it up front is what lets the queue be a dumb executor, and a dumb executor is one
 * that can be reasoned about while it is running in the background.
 *
 * Mirrors `JobSpec.swift`.
 */
public data class JobSpec(
  val jobId: String,
  val inputs: List<Input>,
  val options: RasterCodec.Options,
  val outputDirectory: File,
  /** `{name}`, `{index}`, `{date}`, `{format}`. Empty keeps the source name. */
  val namePattern: String,
  /** 0 means "decide from the hardware". */
  val requestedConcurrency: Int,
  val continueInBackground: Boolean,
) {

  public data class Input(val file: File, val byteSize: Long, val displayName: String)

  /**
   * Sized from the CPU count *and* the device's memory.
   *
   * Cores alone is the wrong answer: each in-flight conversion can hold a
   * full-resolution bitmap, so on a 3 GB phone running six at once is how a 300-image
   * batch gets killed two thirds of the way through. The cap of six exists because past
   * that the disk, not the CPU, is the limit.
   */
  public val resolvedConcurrency: Int
    get() {
      if (requestedConcurrency > 0) return requestedConcurrency
      val cores = Runtime.getRuntime().availableProcessors()
      // maxMemory is the heap this app may grow to, which is the number that actually
      // decides whether a batch survives — not the device's total RAM.
      val heapGb = Runtime.getRuntime().maxMemory().toDouble() / (1024.0 * 1024.0 * 1024.0)
      val byMemory = (heapGb / 0.25).toInt()
      return maxOf(1, minOf(cores, maxOf(1, byMemory), 6))
    }

  /** Where one input's output goes, with collisions resolved rather than overwritten. */
  public fun outputFileFor(input: Input, index: Int): File {
    val ext = FormatMatcher.spec(options.targetFormat)?.extensions?.firstOrNull()
      ?: options.targetFormat
    val base = FileGateway.sanitise(expandedName(input, index))
    return FileGateway.resolveCollision(outputDirectory, "$base.$ext")
  }

  private fun expandedName(input: Input, index: Int): String {
    val sourceName = input.displayName.substringBeforeLast('.', input.displayName)
    if (namePattern.isEmpty()) return sourceName

    // `index` is one-based because it appears in filenames people read.
    return namePattern
      .replace("{name}", sourceName)
      .replace("{index}", String.format(Locale.US, "%03d", index + 1))
      .replace("{date}", dateStamp())
      .replace("{format}", options.targetFormat)
  }

  private fun dateStamp(): String =
    // Fixed locale: a filename is not a place for locale-dependent ordering, and this
    // sorts correctly as text.
    SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

  public companion object {
    public fun from(context: Context, map: ReadableMap): JobSpec? {
      val jobId = map.takeIf { it.hasKey("jobId") }?.getString("jobId")
      if (jobId.isNullOrEmpty()) return null

      val uris = map.takeIf { it.hasKey("inputUris") }?.getArray("inputUris")
      val inputs = buildList {
        for (index in 0 until (uris?.size() ?: 0)) {
          val uri = uris?.getString(index) ?: continue
          val file = resolve(context, uri)
          add(Input(file, file.length(), file.name))
        }
      }

      val directory = map.takeIf { it.hasKey("outputDirectory") }?.getString("outputDirectory")
      return JobSpec(
        jobId = jobId,
        inputs = inputs,
        options = RasterCodec.Options.from(map.takeIf { it.hasKey("options") }?.getMap("options")),
        outputDirectory = if (directory.isNullOrEmpty()) {
          FileGateway.outputDirectory(context)
        } else {
          FileGateway.fileFromUri(directory)
        },
        namePattern = map.takeIf { it.hasKey("namePattern") }?.getString("namePattern") ?: "",
        requestedConcurrency =
          if (map.hasKey("maxConcurrency")) map.getDouble("maxConcurrency").toInt() else 0,
        continueInBackground =
          if (map.hasKey("continueInBackground")) map.getBoolean("continueInBackground") else true,
      )
    }

    private fun resolve(context: Context, uri: String): File =
      if (uri.startsWith("content://")) {
        FileGateway.materialise(context, Uri.parse(uri))
      } else {
        FileGateway.fileFromUri(uri)
      }

    /** One file's failure, in the shape JavaScript expects. */
    public fun failurePayload(input: Input, error: Throwable): WritableMap =
      Arguments.createMap().apply {
        putString("uri", FileGateway.fileUri(input.file))
        putString("displayName", input.displayName)
        putString("code", (error as? ConversionException)?.code ?: "unknown")
        putString("message", error.message ?: "Conversion failed.")
      }
  }
}
