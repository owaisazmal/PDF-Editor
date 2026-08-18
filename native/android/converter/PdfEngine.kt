// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.core

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.pdf.PdfDocument
import android.graphics.pdf.PdfRenderer
import android.os.Build
import android.os.ParcelFileDescriptor
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID
import androidx.exifinterface.media.ExifInterface
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * PDF in both directions, plus the page utilities Android's platform APIs can express.
 *
 * Android gives two halves of a PDF implementation and no middle: `PdfRenderer` reads a
 * document by painting pages into bitmaps, and `PdfDocument` writes one by recording
 * canvas drawing. Neither offers access to page objects, so anything that needs to move a
 * page from one document to another without repainting it — merge, split, reorder — has
 * no platform answer. Those throw here rather than quietly rasterising, because a merge
 * that turns selectable text into photographs is a worse outcome than a merge that says
 * it cannot do it. See `docs/ARCHITECTURE.md` §3.2.
 *
 * What is here is complete: inspection, page rendering at a chosen density, composition
 * from images, and compression — which is defined as rasterise-and-re-encode on both
 * platforms anyway, so Android loses nothing on that one.
 *
 * Mirrors `PdfEngine.swift`.
 */
public object PdfEngine {

  /** Above this an A4 page stops being a document and becomes an allocation failure. */
  private const val MAX_DPI: Double = 600.0
  private const val MIN_DPI: Double = 36.0

  // ------------------------------------------------------------------- sessions --

  /**
   * A verified password, held for as long as the user is working with the document.
   *
   * iOS can keep the unlocked `PDFDocument` itself; Android cannot hold a `PdfRenderer`
   * open across calls, because it owns a file descriptor and permits only one page at a
   * time. So what is retained here is the password, in memory, for the lifetime of the
   * session. It is never written to disk, to the history store, or to a log, and
   * `closeSession` drops it.
   */
  private val sessions = ConcurrentHashMap<String, Session>()

  private data class Session(val uri: String, val password: String)

  @JvmStatic
  public fun unlock(file: File, password: String): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
      throw ConversionException(
        "passwordRequired",
        "Opening password-protected PDFs needs Android 15 or newer on this device.",
      )
    }

    // Opened once purely to verify: a wrong password throws before any work is queued,
    // so the user finds out at the prompt rather than at the end of a long export.
    open(file, password).use { }

    val handle = "pdf-" + UUID.randomUUID()
    sessions[handle] = Session(FileGateway.fileUri(file), password)
    return handle
  }

  @JvmStatic
  public fun closeSession(handle: String) {
    sessions.remove(handle)
  }

  /** The password for a file the user has already unlocked, by handle or by path. */
  private fun password(file: File, sessionHandle: String): String {
    sessions[sessionHandle]?.let { return it.password }
    val uri = FileGateway.fileUri(file)
    return sessions.values.firstOrNull { it.uri == uri }?.password ?: ""
  }

  /**
   * The one way a document is opened.
   *
   * `PdfRenderer` reports an encrypted file by throwing `SecurityException`, which is
   * translated here into the two states the UI can act on: needs a password, or the
   * password given was wrong.
   */
  private fun open(file: File, password: String = ""): PdfRenderer {
    if (!file.exists()) throw ConversionException.unreadable(file.name)

    val descriptor = try {
      ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    } catch (error: IOException) {
      throw ConversionException.unreadable(file.name)
    }

    return try {
      if (password.isNotEmpty() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
        PdfRenderer(descriptor, android.graphics.pdf.LoadParams.Builder().setPassword(password).build())
      } else {
        PdfRenderer(descriptor)
      }
    } catch (error: SecurityException) {
      descriptor.close()
      throw if (password.isEmpty()) {
        ConversionException.passwordRequired()
      } else {
        ConversionException.wrongPassword()
      }
    } catch (error: IOException) {
      descriptor.close()
      throw ConversionException.corrupt(file.name)
    }
  }

  // -------------------------------------------------------------------- inspect --

  /**
   * Page count, page sizes, and whether a password is required.
   *
   * Safe on a locked document: the encryption state is what the UI needs in order to
   * decide whether to ask for a password, and it is readable without one.
   */
  @JvmStatic
  public fun inspect(file: File): WritableMap {
    val result = Arguments.createMap()
    result.putString("uri", FileGateway.fileUri(file))
    result.putString("title", "")

    val known = password(file, "")

    try {
      open(file, known).use { renderer ->
        result.putInt("pageCount", renderer.pageCount)
        result.putBoolean("isEncrypted", known.isNotEmpty())
        result.putBoolean("needsPassword", false)

        val pages = Arguments.createArray()
        for (index in 0 until renderer.pageCount) {
          // Only one page may be open at a time, so this cannot be hoisted.
          renderer.openPage(index).use { page ->
            pages.pushMap(
              Arguments.createMap().apply {
                putInt("index", index)
                putDouble("widthPoints", page.width.toDouble())
                putDouble("heightPoints", page.height.toDouble())
                // PdfRenderer applies page rotation when it paints, so by the time a
                // page reaches us it is already upright and has none left to report.
                putInt("rotation", 0)
              },
            )
          }
        }
        result.putArray("pages", pages)
      }
    } catch (error: ConversionException) {
      if (error.code != "passwordRequired") throw error
      result.putInt("pageCount", 0)
      result.putBoolean("isEncrypted", true)
      result.putBoolean("needsPassword", true)
      result.putArray("pages", Arguments.createArray())
    }

    return result
  }

  // --------------------------------------------------------------------- render --

  public data class RenderOptions(
    val pageRanges: String,
    val dpi: Double,
    val format: String,
    val quality: Int,
    val outputDirectory: File?,
    val namePrefix: String,
  ) {
    public companion object {
      public fun from(map: ReadableMap?): RenderOptions {
        val directory = map.string("outputDirectory")
        return RenderOptions(
          pageRanges = map.string("pageRanges"),
          // Clamped rather than trusted: 1200 DPI on an A4 page is a 100-megapixel
          // bitmap, which is a crash rather than a document.
          dpi = min(max(map.double("dpi", 150.0), MIN_DPI), MAX_DPI),
          format = map.string("format").ifEmpty { "jpeg" },
          quality = min(max(map.int("quality", 90), 1), 100),
          outputDirectory = if (directory.isEmpty()) null else FileGateway.fileFromUri(directory),
          namePrefix = map.string("namePrefix"),
        )
      }
    }
  }

  /**
   * Renders pages to image files, one at a time.
   *
   * Each page is painted, encoded and recycled before the next begins, so peak memory is
   * one page rather than one document. That is the difference between exporting a
   * 400-page scan and being killed a third of the way through it.
   */
  @JvmStatic
  public fun renderPages(
    context: Context,
    file: File,
    sessionHandle: String,
    options: RenderOptions,
  ): WritableMap {
    val started = System.nanoTime()
    val directory = options.outputDirectory ?: FileGateway.outputDirectory(context)
    val format = compressFormat(options.format)
    val extension = FormatMatcher.spec(options.format)?.extensions?.firstOrNull() ?: options.format

    val results = Arguments.createArray()

    open(file, password(file, sessionHandle)).use { renderer ->
      val indices = PdfPageGeometry.expand(options.pageRanges, renderer.pageCount)
      if (indices.isEmpty()) throw ConversionException.corrupt("No pages matched that range.")

      val stem = options.namePrefix.ifEmpty { file.nameWithoutExtension }

      for (index in indices) {
        renderer.openPage(index).use { page ->
          val bitmap = render(page, options.dpi)
          try {
            val name = FileGateway.sanitise("$stem-%03d".format(index + 1))
            val output = FileGateway.resolveCollision(directory, "$name.$extension")

            FileOutputStream(output).use { stream ->
              if (!bitmap.compress(format, options.quality, stream)) {
                throw ConversionException.unsupportedTarget(options.format)
              }
            }

            results.pushMap(
              Arguments.createMap().apply {
                putInt("sourceIndex", index)
                putString("outputUri", FileGateway.fileUri(output))
                putString("outputDisplayName", output.name)
                putString("format", options.format)
                putDouble("byteSize", output.length().toDouble())
                putInt("pixelWidth", bitmap.width)
                putInt("pixelHeight", bitmap.height)
                putInt("qualityUsed", options.quality)
                putDouble("elapsedMs", 0.0)
              },
            )
          } finally {
            bitmap.recycle()
          }
        }
      }
    }

    return Arguments.createMap().apply {
      putArray("results", results)
      putDouble("elapsedMs", elapsedMs(started))
    }
  }

  /**
   * Paints one page at the requested density.
   *
   * The bitmap is filled with white first. `PdfRenderer.render` composites onto whatever
   * is already there, and a PDF page carries no background of its own — without this,
   * every exported page comes out transparent or black.
   */
  private fun render(page: PdfRenderer.Page, dpi: Double): Bitmap {
    val scale = dpi / 72.0
    val width = max((page.width * scale).roundToInt(), 1)
    val height = max((page.height * scale).roundToInt(), 1)

    val bitmap = try {
      Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    } catch (error: OutOfMemoryError) {
      throw ConversionException.outOfMemory()
    }
    bitmap.eraseColor(Color.WHITE)

    val matrix = Matrix().apply { setScale(scale.toFloat(), scale.toFloat()) }
    // FOR_PRINT rather than FOR_DISPLAY: display mode applies screen-oriented hinting
    // that looks wrong once the result is a file rather than a view.
    page.render(bitmap, null, matrix, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
    return bitmap
  }

  // -------------------------------------------------------------------- compose --

  public data class ComposeOptions(
    val pageSize: String,
    val orientation: String,
    val fitMode: String,
    val marginPoints: Double,
    val nUp: Int,
    val gutterPoints: Double,
    val dpi: Double,
    val backgroundColor: String,
  ) {
    public companion object {
      public fun from(map: ReadableMap?): ComposeOptions = ComposeOptions(
        pageSize = map.string("pageSize").ifEmpty { "a4" },
        orientation = map.string("orientation").ifEmpty { "auto" },
        fitMode = map.string("fitMode").ifEmpty { "fit" },
        marginPoints = max(map.double("marginPoints", 36.0), 0.0),
        nUp = max(map.int("nUp", 1), 1),
        gutterPoints = max(map.double("gutterPoints", 12.0), 0.0),
        dpi = min(max(map.double("dpi", 150.0), MIN_DPI), MAX_DPI),
        backgroundColor = map.string("backgroundColor").ifEmpty { "#FFFFFF" },
      )
    }
  }

  /**
   * Composes images into a PDF.
   *
   * Each image is drawn as a page rather than embedded whole, which is what lets margins,
   * fit modes and N-up mean anything. Images are decoded one page at a time.
   */
  @JvmStatic
  public fun composeFromImages(
    images: List<File>,
    output: File,
    options: ComposeOptions,
  ): WritableMap {
    val started = System.nanoTime()
    if (images.isEmpty()) throw ConversionException.corrupt("A PDF needs at least one image.")

    val document = PdfDocument()
    val background = parseColor(options.backgroundColor)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { isFilterBitmap = true }
    var pageNumber = 0

    try {
      images.chunked(options.nUp).forEach { slice ->
        val decoded = slice.mapNotNull { decode(it) }
        if (decoded.isEmpty()) return@forEach

        try {
          val first = decoded.first()
          val size = PdfPageGeometry.page(
            options.pageSize,
            options.orientation,
            // With several images to a page, the paper is chosen from the first —
            // mixing orientations inside one sheet is not a thing.
            first.width.toDouble(),
            first.height.toDouble(),
            options.dpi,
          )

          pageNumber += 1
          val info = PdfDocument.PageInfo.Builder(
            max(size.width.roundToInt(), 1),
            max(size.height.roundToInt(), 1),
            pageNumber,
          ).create()

          val page = document.startPage(info)
          val canvas = page.canvas
          canvas.drawColor(background)

          val bounds = RectF(0f, 0f, info.pageWidth.toFloat(), info.pageHeight.toFloat())
          val margin = options.marginPoints.toFloat()
          val content = RectF(
            bounds.left + margin,
            bounds.top + margin,
            bounds.right - margin,
            bounds.bottom - margin,
          )
          val box = if (content.width() > 0 && content.height() > 0) content else bounds

          PdfPageGeometry.slots(box, options.nUp, options.gutterPoints)
            .zip(decoded)
            .forEach { (slot, bitmap) ->
              val frame = PdfPageGeometry.placement(
                bitmap.width.toDouble(),
                bitmap.height.toDouble(),
                slot,
                options.fitMode,
              )
              // Clipped so `fill` crops into its own slot rather than bleeding over
              // its neighbour.
              canvas.save()
              canvas.clipRect(slot)
              canvas.drawBitmap(bitmap, null, frame, paint)
              canvas.restore()
            }

          document.finishPage(page)
        } finally {
          decoded.forEach { it.recycle() }
        }
      }

      if (pageNumber == 0) throw ConversionException.corrupt("None of those images could be read.")
      writeAtomically(document, output)
    } finally {
      document.close()
    }

    return result(output, pageNumber, started)
  }

  // ------------------------------------------------------------------- compress --

  public data class CompressOptions(val dpi: Double, val quality: Int, val grayscale: Boolean) {
    public companion object {
      public fun from(map: ReadableMap?): CompressOptions = CompressOptions(
        dpi = min(max(map.double("dpi", 150.0), MIN_DPI), MAX_DPI),
        quality = min(max(map.int("quality", 70), 1), 100),
        grayscale = map.boolean("grayscale", false),
      )
    }
  }

  /**
   * Rasterises and re-encodes every page.
   *
   * This is the one operation here that loses something, and it loses a lot: text stops
   * being selectable, searchable and accessible, because each page becomes a photograph
   * of itself. No platform on either side can rewrite an embedded image stream in place,
   * so the alternative is not a better compressor but no feature. The UI warns before
   * applying rather than letting it be discovered afterwards.
   */
  @JvmStatic
  public fun compress(
    file: File,
    output: File,
    sessionHandle: String,
    options: CompressOptions,
  ): WritableMap {
    val started = System.nanoTime()
    val before = file.length()
    val document = PdfDocument()
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { isFilterBitmap = true }
    var pageNumber = 0

    try {
      open(file, password(file, sessionHandle)).use { renderer ->
        if (renderer.pageCount == 0) throw ConversionException.corrupt(file.name)

        for (index in 0 until renderer.pageCount) {
          renderer.openPage(index).use { page ->
            // The page keeps its original dimensions in points. Only the pixels behind
            // it get cheaper, so the document still prints at its intended size.
            val info = PdfDocument.PageInfo.Builder(page.width, page.height, index + 1).create()
            val rendered = render(page, options.dpi)

            val recompressed = try {
              recompress(rendered, options.quality, options.grayscale)
            } finally {
              rendered.recycle()
            }

            try {
              pageNumber += 1
              val target = document.startPage(info)
              target.canvas.drawColor(Color.WHITE)
              target.canvas.drawBitmap(
                recompressed,
                null,
                RectF(0f, 0f, info.pageWidth.toFloat(), info.pageHeight.toFloat()),
                paint,
              )
              document.finishPage(target)
            } finally {
              recompressed.recycle()
            }
          }
        }
      }

      writeAtomically(document, output)
    } finally {
      document.close()
    }

    return result(output, pageNumber, started).apply {
      putDouble("beforeByteSize", before.toDouble())
    }
  }

  /**
   * Round-trips through the JPEG encoder so the page carries its lossy weight into the
   * document, rather than being embedded as a full-fidelity bitmap.
   */
  private fun recompress(bitmap: Bitmap, quality: Int, grayscale: Boolean): Bitmap {
    val source = if (grayscale) desaturate(bitmap) else bitmap
    val bytes = java.io.ByteArrayOutputStream()
    val ok = source.compress(Bitmap.CompressFormat.JPEG, quality, bytes)
    if (source !== bitmap) source.recycle()
    if (!ok) throw ConversionException.corrupt("Could not re-encode a page.")

    val data = bytes.toByteArray()
    return BitmapFactory.decodeByteArray(data, 0, data.size)
      ?: throw ConversionException.corrupt("Could not re-encode a page.")
  }

  private fun desaturate(bitmap: Bitmap): Bitmap {
    val output = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      colorFilter = android.graphics.ColorMatrixColorFilter(
        android.graphics.ColorMatrix().apply { setSaturation(0f) },
      )
    }
    Canvas(output).drawBitmap(bitmap, 0f, 0f, paint)
    return output
  }

  // --------------------------------------------------- not expressible on Android --

  /**
   * Merge, split and page editing all need one thing Android does not provide: the
   * ability to copy a page object from one document into another. `PdfDocument` can only
   * record canvas drawing, so the only implementation available here would repaint each
   * page as a bitmap — turning a 2 MB text document into a 40 MB one whose text can no
   * longer be selected, searched, or read aloud.
   *
   * That is a worse outcome than a clear refusal, so these refuse. The capability matrix
   * reports them closed on Android, and the UI dims the tiles with this reason rather
   * than blaming the device.
   */
  private fun needsObjectLevelAccess(operation: String): Nothing = throw ConversionException(
    "unsupportedTarget",
    "$operation is not available on Android yet — it needs page-level PDF editing that " +
      "the platform does not provide.",
  )

  @JvmStatic
  public fun merge(inputs: List<File>, output: File): WritableMap = needsObjectLevelAccess("Merging PDFs")

  @JvmStatic
  public fun split(file: File, outputDirectory: File, options: ReadableMap?): WritableMap =
    needsObjectLevelAccess("Splitting a PDF")

  @JvmStatic
  public fun editPages(file: File, output: File, operations: ReadableMap?): WritableMap =
    needsObjectLevelAccess("Editing PDF pages")

  // -------------------------------------------------------------------- helpers --

  /**
   * Decodes an image with its EXIF orientation already applied, so a photo taken sideways
   * is upright in the document. `ImageDecoder` does that itself from API 28; below it,
   * the rotation has to be applied by matrix.
   *
   * A file that cannot be decoded returns null rather than throwing: one unreadable
   * image should cost its page, not the whole document.
   */
  private fun decode(file: File): Bitmap? = try {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      ImageDecoder.decodeBitmap(ImageDecoder.createSource(file)) { decoder, _, _ ->
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        decoder.isMutableRequired = false
      }
    } else {
      BitmapFactory.decodeFile(file.absolutePath)?.let { applyExifOrientation(it, file) }
    }
  } catch (error: Throwable) {
    null
  }

  private fun applyExifOrientation(bitmap: Bitmap, file: File): Bitmap {
    val orientation = try {
      ExifInterface(file).getAttributeInt(
        ExifInterface.TAG_ORIENTATION,
        ExifInterface.ORIENTATION_NORMAL,
      )
    } catch (error: IOException) {
      ExifInterface.ORIENTATION_NORMAL
    }

    val matrix = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.postRotate(90f); matrix.postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.postRotate(270f); matrix.postScale(-1f, 1f) }
      else -> return bitmap
    }

    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
      .also { if (it !== bitmap) bitmap.recycle() }
  }

  private fun compressFormat(format: String): Bitmap.CompressFormat = when (format) {
    "png" -> Bitmap.CompressFormat.PNG
    "webp" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      Bitmap.CompressFormat.WEBP_LOSSY
    } else {
      @Suppress("DEPRECATION")
      Bitmap.CompressFormat.WEBP
    }
    "jpeg", "jpg" -> Bitmap.CompressFormat.JPEG
    else -> throw ConversionException.unsupportedTarget(format)
  }

  private fun parseColor(hex: String): Int = try {
    Color.parseColor(if (hex.startsWith("#")) hex else "#$hex")
  } catch (error: IllegalArgumentException) {
    // White, for the same reason transparency flattening defaults to it: a wrong-but-
    // white page is recoverable, a black one is the complaint this path exists to avoid.
    Color.WHITE
  }

  /**
   * Written beside the target and moved into place, so a process death mid-write cannot
   * leave a half-written document where a whole one is expected.
   */
  private fun writeAtomically(document: PdfDocument, output: File) {
    val temporary = File(output.parentFile, ".${UUID.randomUUID()}.pdf")
    try {
      FileOutputStream(temporary).use { document.writeTo(it) }
      if (output.exists()) output.delete()
      if (!temporary.renameTo(output)) throw ConversionException.diskFull()
    } catch (error: IOException) {
      temporary.delete()
      throw ConversionException.diskFull()
    }
  }

  private fun result(output: File, pageCount: Int, started: Long): WritableMap =
    Arguments.createMap().apply {
      putString("outputUri", FileGateway.fileUri(output))
      putString("outputDisplayName", output.name)
      putInt("pageCount", pageCount)
      putDouble("byteSize", output.length().toDouble())
      putDouble("elapsedMs", elapsedMs(started))
    }

  private fun elapsedMs(started: Long): Double = (System.nanoTime() - started) / 1_000_000.0
}

/* ------------------------------------------------------- ReadableMap accessors ---- */

private fun ReadableMap?.string(key: String): String =
  if (this != null && hasKey(key)) getString(key) ?: "" else ""

private fun ReadableMap?.double(key: String, fallback: Double): Double =
  if (this != null && hasKey(key)) getDouble(key) else fallback

private fun ReadableMap?.int(key: String, fallback: Int): Int =
  if (this != null && hasKey(key)) getDouble(key).toInt() else fallback

private fun ReadableMap?.boolean(key: String, fallback: Boolean): Boolean =
  if (this != null && hasKey(key)) getBoolean(key) else fallback
