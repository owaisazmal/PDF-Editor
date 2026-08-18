// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.core

import android.graphics.BitmapFactory
import androidx.exifinterface.media.ExifInterface
import com.owaiskhan.converter.format.FormatTable
import java.io.File
import java.io.InputStream

/**
 * Identifies files from their bytes and reads their header metadata.
 *
 * The same two rules as the Swift implementation:
 *
 *   1. The extension is never trusted. A `.png` that is really a HEIC is a real case,
 *      and a converter that believes the name produces an output identical to its input.
 *   2. Nothing is decoded. `BitmapFactory.Options.inJustDecodeBounds` reads dimensions
 *      from the header alone, so a 200-megapixel file costs the same as a thumbnail.
 *
 * `__tests__` runs the shared fixture corpus through this, the Swift detector and the
 * JavaScript reference implementation, so a divergence fails CI rather than shipping.
 */
public object FormatDetector {

  /** Enough for every fixed signature, both TIFF byte orders, and the SVG prefix scan. */
  public const val SNIFF_BYTES: Int = 4096

  public fun detect(file: File): DetectedFile {
    if (!file.exists() || !file.canRead()) {
      throw ConversionException.unreadable(file.name)
    }

    val prefix = file.inputStream().use { readPrefix(it) }
    val detection = identify(prefix, file.name).apply {
      uri = FileGateway.fileUri(file)
      byteSize = file.length()
    }

    if (detection.byteSize == 0L) {
      detection.format = ""
      detection.confidence = "none"
      detection.reason = "The file is empty (zero bytes)."
      return detection
    }

    readHeaderMetadata(file, prefix, detection)
    return detection
  }

  public fun detect(bytes: ByteArray, filename: String): DetectedFile {
    val detection = identify(bytes.copyOf(minOf(bytes.size, SNIFF_BYTES)), filename)
    detection.byteSize = bytes.size.toLong()
    if (bytes.isEmpty()) {
      detection.format = ""
      detection.confidence = "none"
      detection.reason = "The file is empty (zero bytes)."
    }
    return detection
  }

  private fun readPrefix(stream: InputStream): ByteArray {
    val buffer = ByteArray(SNIFF_BYTES)
    var filled = 0
    while (filled < SNIFF_BYTES) {
      val read = stream.read(buffer, filled, SNIFF_BYTES - filled)
      if (read <= 0) break
      filled += read
    }
    return buffer.copyOf(filled)
  }

  // ---------------------------------------------------------------- signatures --

  private fun identify(bytes: ByteArray, filename: String): DetectedFile {
    val result = DetectedFile(
      displayName = filename,
      claimedFormat = FormatMatcher.formatIdForFilename(filename) ?: "",
    )

    if (bytes.isEmpty()) {
      result.reason = "The file is empty (zero bytes)."
      return result
    }

    for (id in FormatTable.DETECTION_ORDER) {
      when (id) {
        "svg" ->
          if (looksLikeSvg(bytes)) {
            return result.settle("svg", "deep", "XML prefix containing an <svg> element")
          }

        "tiff" -> {
          // Reached only when no more specific TIFF-family signature matched, so this
          // is where DNG, NEF and ARW get separated from a genuine TIFF.
          if (FormatMatcher.matches(bytes, "tiff")) {
            val (format, reason) = resolveTiffFamily(bytes)
            return result.settle(format, "deep", reason)
          }
        }

        // Share the bare TIFF signature; resolved by resolveTiffFamily above.
        "dng", "nef", "arw" -> Unit

        else ->
          if (FormatMatcher.matches(bytes, id)) {
            return result.settle(id, "signature", FormatMatcher.note(bytes, id))
          }
      }
    }

    // Readers tolerate leading junk before %PDF-, so a strict offset-0 test misses
    // files written by sloppy producers.
    val pdfAt = indexOf(bytes, "%PDF-".toByteArray(Charsets.US_ASCII), limit = 1024)
    if (pdfAt > 0) {
      return result.settle("pdf", "deep", "PDF header found at offset $pdfAt after leading junk")
    }

    result.reason =
      "No known signature matched the first bytes of this file. It may be corrupt, " +
        "truncated, or a format this app does not support."
    return result
  }

  private fun DetectedFile.settle(
    format: String,
    confidence: String,
    reason: String,
  ): DetectedFile {
    this.format = format
    this.confidence = confidence
    this.reason = reason
    return this
  }

  // --------------------------------------------------------------- TIFF family --

  private const val TAG_MAKE = 0x010F
  private const val TAG_DNG_VERSION = 0xC612

  /**
   * Walks IFD0 far enough to tell the TIFF-based RAW formats apart. Bounded on
   * purpose: no sub-IFDs are followed, so a malicious or truncated file costs nothing.
   */
  private fun resolveTiffFamily(bytes: ByteArray): Pair<String, String> {
    if (bytes.size < 8) return "tiff" to "TIFF header; too little data to inspect IFD0"

    val littleEndian = bytes[0] == 0x49.toByte() && bytes[1] == 0x49.toByte()

    fun u16(offset: Int): Int? {
      if (offset + 1 >= bytes.size) return null
      val a = bytes[offset].toInt() and 0xFF
      val b = bytes[offset + 1].toInt() and 0xFF
      return if (littleEndian) a or (b shl 8) else (a shl 8) or b
    }

    fun u32(offset: Int): Long? {
      if (offset + 3 >= bytes.size) return null
      val a = (bytes[offset].toInt() and 0xFF).toLong()
      val b = (bytes[offset + 1].toInt() and 0xFF).toLong()
      val c = (bytes[offset + 2].toInt() and 0xFF).toLong()
      val d = (bytes[offset + 3].toInt() and 0xFF).toLong()
      return if (littleEndian) {
        a or (b shl 8) or (c shl 16) or (d shl 24)
      } else {
        (a shl 24) or (b shl 16) or (c shl 8) or d
      }
    }

    if (u16(2) != 42) return "tiff" to "TIFF header; IFD0 unreadable, treating as a plain TIFF"
    val ifd0 = u32(4)?.toInt() ?: return "tiff" to "TIFF header; IFD0 offset unreadable"
    val count = u16(ifd0) ?: return "tiff" to "TIFF header; IFD0 unreadable, treating as a plain TIFF"

    // A plausible IFD0 has tens of entries, not thousands.
    if (count <= 0 || count > 512) {
      return "tiff" to "TIFF header; IFD0 entry count implausible, treating as a plain TIFF"
    }

    var hasDngVersion = false
    var make: String? = null

    for (index in 0 until count) {
      val entry = ifd0 + 2 + index * 12
      if (entry + 12 > bytes.size) break
      val tag = u16(entry) ?: break

      if (tag == TAG_DNG_VERSION) {
        hasDngVersion = true
        continue
      }
      if (tag != TAG_MAKE) continue

      val valueCount = u32(entry + 4)?.toInt() ?: continue
      // ASCII values of four bytes or fewer are stored inline.
      val valueOffset = if (valueCount <= 4) entry + 8 else (u32(entry + 8)?.toInt() ?: continue)
      if (valueOffset <= 0 || valueOffset >= bytes.size) continue

      val end = minOf(valueOffset + valueCount, bytes.size)
      val slice = bytes.copyOfRange(valueOffset, end).takeWhile { it != 0.toByte() }.toByteArray()
      make = String(slice, Charsets.US_ASCII).trim()
    }

    if (hasDngVersion) return "dng" to "TIFF container carrying the DNGVersion tag (50706)"

    val upper = make?.uppercase() ?: ""
    // A Nikon-branded DNG is still a DNG, which is why the tag is checked first.
    return when {
      upper.contains("NIKON") -> "nef" to "TIFF container, EXIF Make \"$make\""
      upper.contains("SONY") -> "arw" to "TIFF container, EXIF Make \"$make\""
      upper.contains("OLYMPUS") -> "orf" to "TIFF container, EXIF Make \"$make\""
      upper.contains("CANON") -> "cr2" to "TIFF container, EXIF Make \"$make\""
      else -> "tiff" to "TIFF container with no RAW marker in IFD0"
    }
  }

  // -------------------------------------------------------------------- text ----

  private fun looksLikeSvg(bytes: ByteArray): Boolean {
    // Any NUL in the prefix means binary, not XML.
    if (bytes.contains(0.toByte())) return false
    val text = String(bytes, Charsets.ISO_8859_1)
    return Regex("<svg[\\s>]", RegexOption.IGNORE_CASE).containsMatchIn(text)
  }

  /**
   * Exact alpha detection for the containers that declare it in a fixed header field.
   *
   * PNG states it in the IHDR colour type: 4 is greyscale+alpha and 6 is truecolour+
   * alpha. A palette PNG can also carry transparency through a tRNS chunk, which sits
   * early enough to find inside the sniff prefix.
   *
   * Anything else reports false rather than guessing.
   */
  private fun prefixHasAlpha(prefix: ByteArray, formatId: String): Boolean = when (formatId) {
    "png" -> {
      // IHDR colour type is the 26th byte: 8 signature + 4 length + 4 type + 8 dims + depth.
      val colourType = if (prefix.size > 25) prefix[25].toInt() and 0xFF else -1
      colourType == 4 || colourType == 6 ||
        indexOf(prefix, "tRNS".toByteArray(Charsets.US_ASCII), limit = prefix.size) > 0
    }
    // A VP8L or extended-format WebP may carry alpha; the ALPH chunk is the marker.
    "webp" -> indexOf(prefix, "ALPH".toByteArray(Charsets.US_ASCII), limit = prefix.size) > 0
    "gif" -> true // The GIF spec's transparent colour index is per-frame; assume yes.
    else -> false
  }

  private fun indexOf(haystack: ByteArray, needle: ByteArray, limit: Int): Int {
    val end = minOf(haystack.size, limit) - needle.size
    for (start in 0..end) {
      if (needle.indices.all { haystack[start + it] == needle[it] }) return start
    }
    return -1
  }

  // ----------------------------------------------------------------- metadata ---

  /** Dimensions, alpha and EXIF, all from headers. Never decodes pixels. */
  private fun readHeaderMetadata(file: File, prefix: ByteArray, detection: DetectedFile) {
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    file.inputStream().use { BitmapFactory.decodeStream(it, null, options) }

    if (options.outWidth > 0) detection.pixelWidth = options.outWidth
    if (options.outHeight > 0) detection.pixelHeight = options.outHeight
    // Whether THIS file carries alpha, never whether the format could.
    //
    // `outConfig` is no help: it reports the config the decoder would target, which is
    // ARGB_8888 for practically everything, so trusting it made Android warn about
    // flattening transparency on a fully opaque HEIC while iOS — which reads the real
    // flag from ImageIO — stayed quiet. Android has no cheap header-level equivalent,
    // so the container is read directly where that is exact and inexpensive, and the
    // answer is "no" otherwise.
    //
    // Correctness never depends on this: the codec composites onto the background fill
    // whenever the destination lacks an alpha channel, whatever this reports. It drives
    // the advisory shown before converting, nothing else.
    detection.hasAlpha = prefixHasAlpha(prefix, detection.format)

    if (options.outColorSpace != null) {
      detection.colorSpace = options.outColorSpace?.name ?: ""
    }

    // ExifInterface tolerates formats without EXIF, so this is safe to attempt for
    // anything — it simply reports nothing when there is nothing to read.
    runCatching {
      file.inputStream().use { stream ->
        val exif = ExifInterface(stream)
        detection.exifOrientation =
          exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, 0)
        detection.hasGpsMetadata =
          exif.getAttribute(ExifInterface.TAG_GPS_LATITUDE) != null ||
          exif.getAttribute(ExifInterface.TAG_GPS_LONGITUDE) != null
      }
    }
  }
}
