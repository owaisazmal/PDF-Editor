// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.core

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorSpace
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.os.Build
import androidx.exifinterface.media.ExifInterface
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.io.FileOutputStream

/**
 * Decode, transform, encode.
 *
 * The same five things the Swift codec gets right, achieved differently because the
 * platform differs:
 *
 *   1. **Orientation is baked into pixels.** `ImageDecoder` applies the EXIF rotation
 *      while decoding on API 28+; below that `BitmapFactory` does not, so the rotation
 *      is applied by matrix. Either way the written file carries orientation 1, because
 *      copying the tag forward would rotate the image a second time.
 *   2. **Decoding is downsampled.** `setTargetSampleSize` and `inSampleSize` mean a
 *      200-megapixel source is never fully realised in memory.
 *   3. **Transparency is composited, never dropped.** Flattening to JPEG fills first.
 *      A black background here is the top one-star complaint in this category.
 *   4. **Colour space is normalised to sRGB.** Wide-gamut output renders wrong in apps
 *      that ignore the profile, and users read that as our bug.
 *   5. **Writes are atomic.** Output goes to a temporary file and is renamed into place
 *      only on success, so a process death mid-encode cannot leave a truncated file.
 */
public object RasterCodec {

  public data class Options(
    val targetFormat: String = "jpeg",
    val quality: Int = 82,
    val targetByteSize: Int = 0,
    val resizeMode: String = "none",
    val resizePercent: Double = 100.0,
    val maxWidth: Int = 0,
    val maxHeight: Int = 0,
    val exactWidth: Int = 0,
    val exactHeight: Int = 0,
    val allowUpscale: Boolean = false,
    val rotate: Int = 0,
    val flipHorizontal: Boolean = false,
    val flipVertical: Boolean = false,
    val metadataMode: String = "keepExceptGps",
    val convertToSrgb: Boolean = true,
    val backgroundColor: String = "#FFFFFF",
    val lossless: Boolean = false,
    val frameIndex: Int = 0,
  ) {
    public companion object {
      /**
       * Reads the validated options object sent from JavaScript. Every field keeps its
       * default when absent, so a missing key degrades rather than throwing —
       * validation already happened on the other side of the bridge.
       */
      public fun from(map: ReadableMap?): Options {
        if (map == null) return Options()
        val resize = map.takeIf { it.hasKey("resize") }?.getMap("resize")
        val metadata = map.takeIf { it.hasKey("metadata") }?.getMap("metadata")
        val background = map.takeIf { it.hasKey("background") }?.getMap("background")

        fun ReadableMap?.str(key: String, fallback: String) =
          if (this != null && hasKey(key) && !isNull(key)) getString(key) ?: fallback else fallback
        fun ReadableMap?.int(key: String, fallback: Int) =
          if (this != null && hasKey(key) && !isNull(key)) getDouble(key).toInt() else fallback
        fun ReadableMap?.dbl(key: String, fallback: Double) =
          if (this != null && hasKey(key) && !isNull(key)) getDouble(key) else fallback
        fun ReadableMap?.bool(key: String, fallback: Boolean) =
          if (this != null && hasKey(key) && !isNull(key)) getBoolean(key) else fallback

        return Options(
          targetFormat = map.str("targetFormat", "jpeg"),
          quality = map.int("quality", 82),
          targetByteSize = map.int("targetByteSize", 0),
          resizeMode = resize.str("mode", "none"),
          resizePercent = resize.dbl("percent", 100.0),
          maxWidth = resize.int("maxWidth", 0),
          maxHeight = resize.int("maxHeight", 0),
          exactWidth = resize.int("exactWidth", 0),
          exactHeight = resize.int("exactHeight", 0),
          allowUpscale = resize.bool("allowUpscale", false),
          rotate = map.int("rotate", 0),
          flipHorizontal = map.bool("flipHorizontal", false),
          flipVertical = map.bool("flipVertical", false),
          metadataMode = metadata.str("mode", "keepExceptGps"),
          convertToSrgb = map.bool("convertToSrgb", true),
          backgroundColor = background.str("color", "#FFFFFF"),
          lossless = map.bool("lossless", false),
          frameIndex = map.int("frameIndex", 0),
        )
      }
    }
  }

  public data class Result(
    val outputFile: File,
    val format: String,
    val byteSize: Long,
    val pixelWidth: Int,
    val pixelHeight: Int,
    val qualityUsed: Int,
    val elapsedMs: Double,
  ) {
    public fun toWritableMap(): WritableMap = Arguments.createMap().apply {
      putString("outputUri", FileGateway.fileUri(outputFile))
      putString("outputDisplayName", outputFile.name)
      putString("format", format)
      putDouble("byteSize", byteSize.toDouble())
      putInt("pixelWidth", pixelWidth)
      putInt("pixelHeight", pixelHeight)
      putInt("qualityUsed", qualityUsed)
      putDouble("elapsedMs", elapsedMs)
    }
  }

  // ------------------------------------------------------------------- entry ----

  public fun convert(
    input: File,
    requestedOutput: File?,
    outputDirectory: File,
    options: Options,
  ): Result {
    val started = System.nanoTime()

    if (!input.exists()) throw ConversionException.unreadable(input.name)

    val compressFormat = compressFormatFor(options.targetFormat)
      ?: throw ConversionException.unsupportedTarget(options.targetFormat)

    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    input.inputStream().use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
      throw ConversionException.corrupt(input.name)
    }

    val target = resolveTargetSize(bounds.outWidth, bounds.outHeight, options)
    val decoded = decode(input, maxOf(target.first, target.second), options)

    val flatten = FormatMatcher.spec(options.targetFormat)?.supportsAlpha != true
    val transformed = try {
      transform(decoded, target, options, flatten)
    } finally {
      // The decode result is no longer needed once redrawn; releasing it here keeps
      // peak memory to one bitmap rather than two across a batch.
      if (decoded !== null) decoded.recycle()
    }

    val output = requestedOutput ?: nextAvailableOutput(outputDirectory, input, options.targetFormat)
    ensureSpace(output, transformed)

    val qualityUsed = encodeAtomically(transformed, output, compressFormat, options)
    copyMetadata(input, output, options)

    val result = Result(
      outputFile = output,
      format = options.targetFormat,
      byteSize = output.length(),
      pixelWidth = transformed.width,
      pixelHeight = transformed.height,
      qualityUsed = qualityUsed,
      elapsedMs = (System.nanoTime() - started) / 1_000_000.0,
    )
    transformed.recycle()
    return result
  }

  // ------------------------------------------------------------------ decode ----

  private fun decode(input: File, maxPixelSize: Int, options: Options): Bitmap {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val source = ImageDecoder.createSource(input)
      return try {
        ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
          decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
          decoder.isMutableRequired = true
          if (options.convertToSrgb) {
            decoder.setTargetColorSpace(ColorSpace.get(ColorSpace.Named.SRGB))
          }
          // Downsampling at decode time is what keeps a huge source from becoming a
          // huge allocation.
          if (maxPixelSize > 0) {
            val longest = maxOf(info.size.width, info.size.height)
            if (longest > maxPixelSize) {
              decoder.setTargetSampleSize(sampleSizeFor(longest, maxPixelSize))
            }
          }
        }
      } catch (error: OutOfMemoryError) {
        throw ConversionException.outOfMemory()
      } catch (error: Exception) {
        throw ConversionException.corrupt(input.name)
      }
    }

    // API 26-27: HEIF cannot be decoded at all, and BitmapFactory ignores EXIF
    // orientation, so the rotation is applied by matrix in transform().
    val opts = BitmapFactory.Options().apply {
      inSampleSize = if (maxPixelSize > 0) {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        input.inputStream().use { BitmapFactory.decodeStream(it, null, bounds) }
        sampleSizeFor(maxOf(bounds.outWidth, bounds.outHeight), maxPixelSize)
      } else {
        1
      }
      inPreferredConfig = Bitmap.Config.ARGB_8888
      inMutable = true
    }
    return input.inputStream().use { BitmapFactory.decodeStream(it, null, opts) }
      ?: throw ConversionException.unsupportedSource(
        FormatMatcher.spec(options.targetFormat)?.label ?: "this format",
      )
  }

  /** Powers of two only — anything else makes BitmapFactory round anyway. */
  private fun sampleSizeFor(longestEdge: Int, maxPixelSize: Int): Int {
    var sample = 1
    while (longestEdge / (sample * 2) >= maxPixelSize) sample *= 2
    return sample
  }

  // --------------------------------------------------------------- transform ----

  private fun transform(
    source: Bitmap,
    target: Pair<Int, Int>,
    options: Options,
    flatten: Boolean,
  ): Bitmap {
    val matrix = Matrix()

    // ImageDecoder already applied EXIF orientation on API 28+; below that it has to
    // be done here. Either way the output file is written with orientation 1.
    if (options.rotate != 0) matrix.postRotate(options.rotate.toFloat())
    if (options.flipHorizontal) matrix.postScale(-1f, 1f)
    if (options.flipVertical) matrix.postScale(1f, -1f)

    val scaled = if (source.width != target.first || source.height != target.second) {
      Bitmap.createScaledBitmap(source, target.first, target.second, true)
    } else {
      source
    }

    val oriented = if (matrix.isIdentity) {
      scaled
    } else {
      Bitmap.createBitmap(scaled, 0, 0, scaled.width, scaled.height, matrix, true).also {
        if (scaled !== source) scaled.recycle()
      }
    }

    if (!flatten) return oriented

    // A flattened destination gets an opaque bitmap, so there is no alpha channel left
    // for a stray transparent pixel to survive in.
    val flattened = Bitmap.createBitmap(oriented.width, oriented.height, Bitmap.Config.ARGB_8888)
    Canvas(flattened).apply {
      drawColor(parseColor(options.backgroundColor))
      drawBitmap(oriented, 0f, 0f, null)
    }
    if (oriented !== source) oriented.recycle()
    return flattened
  }

  /**
   * Parses `#RRGGBB`. Falls back to white, which is the safe default when flattening —
   * a wrong-but-white background is recoverable; a black one is the complaint this
   * whole path exists to avoid.
   */
  private fun parseColor(hex: String): Int =
    runCatching { Color.parseColor(hex) }.getOrDefault(Color.WHITE)

  // ------------------------------------------------------------------ sizing ----

  private fun resolveTargetSize(
    sourceWidth: Int,
    sourceHeight: Int,
    options: Options,
  ): Pair<Int, Int> {
    var width = sourceWidth
    var height = sourceHeight

    when (options.resizeMode) {
      "percent" -> {
        val scale = options.resizePercent / 100.0
        width = Math.round(width * scale).toInt()
        height = Math.round(height * scale).toInt()
      }
      "maxDimension" -> {
        val maxW = if (options.maxWidth > 0) options.maxWidth.toDouble() else Double.MAX_VALUE
        val maxH = if (options.maxHeight > 0) options.maxHeight.toDouble() else Double.MAX_VALUE
        val scale = minOf(maxW / width, maxH / height)
        if (scale < 1.0 || options.allowUpscale) {
          width = Math.round(width * scale).toInt()
          height = Math.round(height * scale).toInt()
        }
      }
      "exact" -> {
        width = options.exactWidth
        height = options.exactHeight
      }
    }

    if (!options.allowUpscale && options.resizeMode != "exact") {
      width = minOf(width, sourceWidth)
      height = minOf(height, sourceHeight)
    }
    return maxOf(width, 1) to maxOf(height, 1)
  }

  // ------------------------------------------------------------------ encode ----

  private fun encodeAtomically(
    bitmap: Bitmap,
    output: File,
    format: Bitmap.CompressFormat,
    options: Options,
  ): Int {
    val temporary = File(output.parentFile, ".${output.name}.partial")
    try {
      val quality = writeSearchingForQuality(bitmap, temporary, format, options)

      // The rename is the commit point: until it succeeds, `output` does not exist, so
      // a crash cannot leave a truncated file where a finished one should be.
      if (output.exists()) output.delete()
      if (!temporary.renameTo(output)) throw ConversionException.diskFull()
      return quality
    } finally {
      if (temporary.exists()) temporary.delete()
    }
  }

  /**
   * Encodes once at the requested quality, or binary-searches when a target size is
   * set. Bounded to eight probes: past that the size gain is below what anyone notices
   * and the wait is not.
   */
  private fun writeSearchingForQuality(
    bitmap: Bitmap,
    file: File,
    format: Bitmap.CompressFormat,
    options: Options,
  ): Int {
    if (options.targetByteSize <= 0 || !isLossy(options.targetFormat)) {
      write(bitmap, file, format, options.quality)
      return options.quality
    }

    var low = 1
    var high = 100
    var best: Int? = null

    repeat(8) {
      if (low > high) return@repeat
      val mid = (low + high) / 2
      write(bitmap, file, format, mid)
      if (file.length() <= options.targetByteSize) {
        best = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }

    // Re-encode at the best quality found, since the last probe may have overshot.
    val quality = best ?: 1
    write(bitmap, file, format, quality)
    return quality
  }

  private fun write(bitmap: Bitmap, file: File, format: Bitmap.CompressFormat, quality: Int) {
    FileOutputStream(file).use { stream ->
      if (!bitmap.compress(format, quality.coerceIn(1, 100), stream)) {
        throw ConversionException.diskFull()
      }
      stream.flush()
      stream.fd.sync()
    }
  }

  // ---------------------------------------------------------------- metadata ----

  /**
   * Applies the metadata policy and always writes orientation 1, because the rotation
   * is now in the pixels — leaving the original tag would rotate the image again.
   *
   * `ExifInterface` can only write to JPEG, PNG and WebP; for anything else the tags
   * are simply not carried, which is correct rather than a silent failure.
   */
  private fun copyMetadata(input: File, output: File, options: Options) {
    val writable = options.targetFormat == "jpeg" ||
      options.targetFormat == "png" ||
      options.targetFormat == "webp"
    if (!writable) return

    runCatching {
      val target = ExifInterface(output.absolutePath)

      if (options.metadataMode != "stripAll") {
        val source = ExifInterface(input.absolutePath)
        for (tag in CARRIED_TAGS) {
          source.getAttribute(tag)?.let { target.setAttribute(tag, it) }
        }
        if (options.metadataMode == "keepExceptGps") {
          for (tag in GPS_TAGS) target.setAttribute(tag, null)
        }
      }

      target.setAttribute(
        ExifInterface.TAG_ORIENTATION,
        ExifInterface.ORIENTATION_NORMAL.toString(),
      )
      target.saveAttributes()
    }
  }

  /** Capture context worth keeping. Deliberately excludes every GPS tag. */
  private val CARRIED_TAGS = listOf(
    ExifInterface.TAG_DATETIME,
    ExifInterface.TAG_DATETIME_ORIGINAL,
    ExifInterface.TAG_DATETIME_DIGITIZED,
    ExifInterface.TAG_MAKE,
    ExifInterface.TAG_MODEL,
    ExifInterface.TAG_F_NUMBER,
    ExifInterface.TAG_EXPOSURE_TIME,
    ExifInterface.TAG_PHOTOGRAPHIC_SENSITIVITY,
    ExifInterface.TAG_FOCAL_LENGTH,
    ExifInterface.TAG_WHITE_BALANCE,
    ExifInterface.TAG_LENS_MAKE,
    ExifInterface.TAG_LENS_MODEL,
    ExifInterface.TAG_SOFTWARE,
  )

  /**
   * Cleared under the default policy. Location is the metadata people are genuinely
   * surprised to have shared; capture date and camera model are the metadata they are
   * annoyed to lose.
   */
  private val GPS_TAGS = listOf(
    ExifInterface.TAG_GPS_LATITUDE,
    ExifInterface.TAG_GPS_LATITUDE_REF,
    ExifInterface.TAG_GPS_LONGITUDE,
    ExifInterface.TAG_GPS_LONGITUDE_REF,
    ExifInterface.TAG_GPS_ALTITUDE,
    ExifInterface.TAG_GPS_ALTITUDE_REF,
    ExifInterface.TAG_GPS_TIMESTAMP,
    ExifInterface.TAG_GPS_DATESTAMP,
    ExifInterface.TAG_GPS_PROCESSING_METHOD,
    ExifInterface.TAG_GPS_AREA_INFORMATION,
  )

  // ------------------------------------------------------------------- paths ----

  private fun nextAvailableOutput(directory: File, input: File, format: String): File {
    directory.mkdirs()
    val base = input.nameWithoutExtension
    val ext = FormatMatcher.spec(format)?.extensions?.firstOrNull() ?: format

    var candidate = File(directory, "$base.$ext")
    var suffix = 1
    // Never silently overwrite.
    while (candidate.exists()) {
      candidate = File(directory, "$base ($suffix).$ext")
      suffix++
    }
    return candidate
  }

  /** Checked before encoding, so a full disk gives a clear message, not a stub file. */
  private fun ensureSpace(output: File, bitmap: Bitmap) {
    val directory = output.parentFile ?: return
    directory.mkdirs()
    val estimate = bitmap.width.toLong() * bitmap.height.toLong() * 4L
    if (directory.usableSpace in 1 until estimate) throw ConversionException.diskFull()
  }

  // ----------------------------------------------------------------- formats ----

  private fun compressFormatFor(formatId: String): Bitmap.CompressFormat? = when (formatId) {
    "jpeg" -> Bitmap.CompressFormat.JPEG
    "png" -> Bitmap.CompressFormat.PNG
    "webp" ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Bitmap.CompressFormat.WEBP_LOSSY
      } else {
        @Suppress("DEPRECATION")
        Bitmap.CompressFormat.WEBP
      }
    else -> null
  }

  private fun isLossy(formatId: String): Boolean =
    formatId == "jpeg" || formatId == "webp" || formatId == "avif" || formatId == "heic"
}
