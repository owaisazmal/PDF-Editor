// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.core

import android.app.ActivityManager
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
  /**
   * Free device RAM when the batch was described, in bytes. Zero means it could not be
   * read, which is treated as "assume the worst" rather than "assume plenty".
   */
  val availableMemoryBytes: Long = 0,
) {

  public data class Input(val file: File, val byteSize: Long, val displayName: String)

  /**
   * Sized from the CPU count and the memory a decoded bitmap actually competes for.
   *
   * Cores alone is the wrong answer: each in-flight conversion holds a full-resolution
   * bitmap, so running six at once on a small phone is how a long batch gets killed two
   * thirds of the way through. The cap of six exists because past that the disk, not the
   * CPU, is the limit.
   *
   * The memory half of that used to read `Runtime.maxMemory()`, which is the *Java* heap.
   * Bitmap pixels have not lived there since API 26 -- they are native allocations, and
   * the Java collector sees only the few hundred bytes of wrapper object, so it feels no
   * pressure worth acting on while hundreds of megabytes pile up outside its view. The
   * number that decides whether a batch survives is therefore free device RAM, and the
   * process that loses when it runs out is killed outright by the low-memory killer
   * rather than given an `OutOfMemoryError` it could catch and report.
   *
   * A third of what is free, because the rest of the system needs to keep running and a
   * foreground app that starves everything else is killed for it.
   */
  public val resolvedConcurrency: Int
    get() {
      if (requestedConcurrency > 0) return requestedConcurrency
      val cores = Runtime.getRuntime().availableProcessors()
      val budget = availableMemoryBytes / 3
      val byMemory = (budget / BYTES_PER_CONVERSION).toInt()
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
    // Trimmed, not merely checked for empty: a field the user typed into and then
    // cleared can hold spaces, and a batch named "   " is not what they asked for.
    val pattern = namePattern.trim()
    if (pattern.isEmpty()) return sourceName

    // `index` is one-based because it appears in filenames people read.
    return pattern
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

    /**
     * What one in-flight conversion costs, near enough.
     *
     * A twelve-megapixel photo is about 48 MB decoded at four bytes a pixel, and the
     * transformed copy sits alongside it while the encoder reads from one and writes the
     * other. 192 MB leaves room for that pair plus the codec's own buffers, which for
     * HEIC means a whole HEVC decoder instance.
     */
    private const val BYTES_PER_CONVERSION: Long = 192L * 1024 * 1024

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
        availableMemoryBytes = availableMemory(context),
      )
    }

    /** Zero when the service is unreachable, which sizes the batch down rather than up. */
    private fun availableMemory(context: Context): Long {
      val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        ?: return 0
      return runCatching {
        ActivityManager.MemoryInfo().also { manager.getMemoryInfo(it) }.availMem
      }.getOrDefault(0)
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
