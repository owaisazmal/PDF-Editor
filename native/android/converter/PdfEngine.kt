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
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.multipdf.PDFMergerUtility
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * PDF in both directions, plus the page utilities.
 *
 * Two engines, each doing what it is best at. Android's own `PdfRenderer` and
 * `PdfDocument` paint pages and record canvas drawing, which is exactly right for
 * rendering pages to images, composing a document from photos, and compressing one.
 * Neither exposes a page object, so anything that has to move a page between documents
 * without repainting it — merge, split, reorder — goes through **PDFBox** instead, which
 * works on the page objects themselves. Text stays selectable, searchable and readable
 * by a screen reader, and pulling one page out of a 40 MB scan does not rasterise the
 * other 399.
 *
 * PDFBox also removes the password problem. `PdfRenderer` gained a password API only in
 * Android 15; PDFBox decrypts on every version this app supports, so an encrypted
 * document behaves the same on a five-year-old phone as on a new one.
 *
 * Mirrors `PdfEngine.swift`.
 */
public object PdfEngine {

  /** Above this an A4 page stops being a document and becomes an allocation failure. */
  private const val MAX_DPI: Double = 600.0
  private const val MIN_DPI: Double = 36.0

  /** Names every decrypted copy, so a stale one can be recognised and removed. */
  private const val DECRYPTED_PREFIX: String = "unlocked-"

  /** Beyond this a merge spills to temporary files rather than growing the heap. */
  private const val MERGE_HEAP_BYTES: Long = 32L * 1024 * 1024

  // ------------------------------------------------------------------- sessions --

  /**
   * An unlocked document, held for as long as the user is working with it.
   *
   * What is retained is a **decrypted copy in the app's own cache directory**, not the
   * password. That is worth being plain about, because it is a real trade: a
   * password-protected file the user opens here exists in plaintext, in storage no other
   * app can read without root, until the session closes. It buys the thing that matters —
   * every operation downstream works on an ordinary PDF, on every Android version, with
   * no special case — and the copy is deleted when the session closes and again on the
   * next launch, so a crash cannot leave one behind indefinitely.
   *
   * The password itself is used once, to decrypt, and never stored anywhere.
   */
  private val sessions = ConcurrentHashMap<String, Session>()

  private data class Session(val uri: String, val decrypted: File)

  private val resourcesReady = AtomicBoolean(false)

  /** PDFBox ships its font metrics as Android assets and has to be pointed at them. */
  private fun prepare(context: Context) {
    if (resourcesReady.compareAndSet(false, true)) {
      PDFBoxResourceLoader.init(context.applicationContext)
      purgeDecryptedCopies(context)
    }
  }

  /**
   * Removes decrypted copies left behind by a previous run.
   *
   * Called once per process rather than on a timer: if the app died mid-session, this is
   * the first moment it can tidy up, and it is also the last moment anything could still
   * be using them.
   */
  private fun purgeDecryptedCopies(context: Context) {
    FileGateway.temporaryDirectory(context)
      .listFiles { file -> file.name.startsWith(DECRYPTED_PREFIX) }
      ?.forEach { it.delete() }
  }

  @JvmStatic
  public fun unlock(context: Context, file: File, password: String): String {
    prepare(context)

    val decrypted = File(
      FileGateway.temporaryDirectory(context),
      "$DECRYPTED_PREFIX${UUID.randomUUID()}.pdf",
    )

    try {
      PDDocument.load(file, password).use { document ->
        if (!document.isEncrypted) {
          // Not encrypted after all — a session would be a decrypted copy of a document
          // that was never locked, which is a plaintext file for nothing.
          return handleFor(file, file)
        }
        document.isAllSecurityToBeRemoved = true
        document.save(decrypted)
      }
    } catch (error: InvalidPasswordException) {
      decrypted.delete()
      throw ConversionException.wrongPassword()
    } catch (error: IOException) {
      decrypted.delete()
      throw ConversionException.corrupt(file.name)
    }

    return handleFor(file, decrypted)
  }

  private fun handleFor(original: File, usable: File): String {
    val handle = "pdf-" + UUID.randomUUID()
    sessions[handle] = Session(FileGateway.fileUri(original), usable)
    return handle
  }

  @JvmStatic
  public fun closeSession(handle: String) {
    val session = sessions.remove(handle) ?: return
    // Only a copy we made is ours to delete; a session over an unencrypted file points
    // at the user's own document.
    if (session.decrypted.name.startsWith(DECRYPTED_PREFIX)) session.decrypted.delete()
  }

  /**
   * The file an operation should actually open.
   *
   * An unlocked session resolves to its decrypted copy, so nothing downstream — not
   * `PdfRenderer`, not the merger — ever has to know the original was encrypted.
   */
  private fun resolve(file: File, sessionHandle: String = ""): File {
    sessions[sessionHandle]?.let { return it.decrypted }
    val uri = FileGateway.fileUri(file)
    return sessions.values.firstOrNull { it.uri == uri }?.decrypted ?: file
  }

  /**
   * Opens a document for painting.
   *
   * By the time anything reaches here the file is unencrypted — an encrypted one was
   * decrypted into a session copy first — so a `SecurityException` means that step was
   * skipped, and is reported as a document that still needs a password.
   */
  private fun open(file: File): PdfRenderer {
    if (!file.exists()) throw ConversionException.unreadable(file.name)

    val descriptor = try {
      ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    } catch (error: IOException) {
      throw ConversionException.unreadable(file.name)
    }

    return try {
      PdfRenderer(descriptor)
    } catch (error: SecurityException) {
      descriptor.close()
      throw ConversionException.passwordRequired()
    } catch (error: IOException) {
      descriptor.close()
      throw ConversionException.corrupt(file.name)
    }
  }

  /** Opens a document for page-level work, through the session copy when there is one. */
  private fun load(context: Context, file: File, sessionHandle: String = ""): PDDocument {
    prepare(context)
    return try {
      PDDocument.load(resolve(file, sessionHandle))
    } catch (error: InvalidPasswordException) {
      throw ConversionException.passwordRequired()
    } catch (error: IOException) {
      throw ConversionException.corrupt(file.name)
    }
  }

  // -------------------------------------------------------------------- inspect --

  /**
   * Page count, page sizes, and whether a password is required.
   *
   * Read through PDFBox rather than `PdfRenderer`, which cannot open an encrypted file
   * at all below Android 15 — and the encryption state is the one thing the UI must know
   * before it can decide whether to ask for a password.
   */
  @JvmStatic
  public fun inspect(context: Context, file: File): WritableMap {
    prepare(context)

    val result = Arguments.createMap()
    result.putString("uri", FileGateway.fileUri(file))

    val usable = resolve(file)
    val unlocked = usable !== file

    val document = try {
      PDDocument.load(usable)
    } catch (error: InvalidPasswordException) {
      // Locked and not yet unlocked. Everything the prompt needs, and nothing it does not.
      result.putInt("pageCount", 0)
      result.putBoolean("isEncrypted", true)
      result.putBoolean("needsPassword", true)
      result.putArray("pages", Arguments.createArray())
      result.putString("title", "")
      return result
    } catch (error: IOException) {
      throw ConversionException.corrupt(file.name)
    }

    document.use { pdf ->
      result.putInt("pageCount", pdf.numberOfPages)
      result.putBoolean("isEncrypted", unlocked || pdf.isEncrypted)
      result.putBoolean("needsPassword", false)
      result.putString("title", pdf.documentInformation?.title ?: "")

      val pages = Arguments.createArray()
      for (index in 0 until pdf.numberOfPages) {
        val page = pdf.getPage(index)
        val box = page.mediaBox
        val rotation = ((page.rotation % 360) + 360) % 360
        // Reported the way the page will actually be painted. A page rotated a quarter
        // turn is taller than it is wide once drawn, and a UI told otherwise would offer
        // the wrong paper size for it.
        val quarterTurned = rotation == 90 || rotation == 270
        pages.pushMap(
          Arguments.createMap().apply {
            putInt("index", index)
            putDouble("widthPoints", (if (quarterTurned) box.height else box.width).toDouble())
            putDouble("heightPoints", (if (quarterTurned) box.width else box.height).toDouble())
            putInt("rotation", rotation)
          },
        )
      }
      result.putArray("pages", pages)
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

    open(resolve(file, sessionHandle)).use { renderer ->
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
      open(resolve(file, sessionHandle)).use { renderer ->
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

  // ------------------------------------------------------------- page-level work --
  //
  // Everything below moves page objects between documents rather than repainting them.
  // That is the whole reason PDFBox is here: text stays selectable, searchable and
  // readable by a screen reader, links survive, and a page pulled out of a 40 MB scan
  // costs the size of that page rather than a fresh rasterisation of the whole file.

  /**
   * Concatenates documents.
   *
   * `PDFMergerUtility` rather than a hand-rolled page copy, because merging is where the
   * details live: shared resources, name collisions between the two documents' object
   * trees, and outlines that have to be rebuilt. Its scratch space is capped so a merge
   * of several large scans spills to disk instead of growing the heap until it dies.
   */
  @JvmStatic
  public fun merge(context: Context, inputs: List<File>, output: File): WritableMap {
    prepare(context)
    val started = System.nanoTime()
    if (inputs.size < 2) throw ConversionException.corrupt("Merging needs at least two documents.")

    val temporary = File(output.parentFile, ".${UUID.randomUUID()}.pdf")
    try {
      val merger = PDFMergerUtility()
      merger.destinationFileName = temporary.absolutePath
      inputs.forEach { merger.addSource(resolve(it)) }
      merger.mergeDocuments(MemoryUsageSetting.setupMixed(MERGE_HEAP_BYTES))

      val pageCount = PDDocument.load(temporary).use { it.numberOfPages }
      moveIntoPlace(temporary, output)
      return result(output, pageCount, started)
    } catch (error: InvalidPasswordException) {
      temporary.delete()
      throw ConversionException.passwordRequired()
    } catch (error: IOException) {
      temporary.delete()
      throw ConversionException.diskFull()
    }
  }

  /**
   * Splits by explicit ranges, or every N pages when none are given.
   *
   * `1-3,7,9-` produces three documents, in the order written. Ranges are how people
   * think about pulling a chapter out; every-N is how they think about breaking a scan
   * into single sheets.
   */
  @JvmStatic
  public fun split(
    context: Context,
    file: File,
    outputDirectory: File,
    options: ReadableMap?,
  ): WritableMap {
    val started = System.nanoTime()
    val ranges = options.string("ranges")
    val everyN = max(options.int("everyNPages", 1), 1)
    val stem = options.string("namePrefix").ifEmpty { file.nameWithoutExtension }

    val outputs = Arguments.createArray()

    load(context, file).use { source ->
      if (source.numberOfPages == 0) throw ConversionException.corrupt(file.name)

      val groups = if (ranges.isBlank()) {
        (0 until source.numberOfPages).chunked(everyN)
      } else {
        ranges.split(",")
          .map { PdfPageGeometry.expand(it, source.numberOfPages) }
          .filter { it.isNotEmpty() }
      }

      if (groups.isEmpty()) throw ConversionException.corrupt("No pages matched that range.")

      groups.forEachIndexed { position, pages ->
        val part = PDDocument()
        try {
          // The source stays open for the save: an imported page still points at the
          // resources it came from until the new document is written.
          pages.forEach { part.importPage(source.getPage(it)) }
          if (part.numberOfPages == 0) return@forEachIndexed

          val name = FileGateway.sanitise("$stem-%03d".format(position + 1))
          val output = FileGateway.resolveCollision(outputDirectory, "$name.pdf")
          part.save(output)

          outputs.pushMap(
            Arguments.createMap().apply {
              putString("outputUri", FileGateway.fileUri(output))
              putString("outputDisplayName", output.name)
              putInt("pageCount", part.numberOfPages)
              putDouble("byteSize", output.length().toDouble())
              // The pages this part came from, one-based, so the UI can say
              // "pages 4-6" rather than "part 2".
              putArray(
                "sourcePages",
                Arguments.createArray().apply { pages.forEach { pushInt(it + 1) } },
              )
            },
          )
        } finally {
          part.close()
        }
      }
    }

    return Arguments.createMap().apply {
      putArray("results", outputs)
      putDouble("elapsedMs", elapsedMs(started))
    }
  }

  /**
   * Deletes, rotates and reorders in one pass.
   *
   * One pass matters: applied separately, a delete would invalidate the indices the
   * rotate and reorder were written against. Everything here is resolved against the
   * original page numbering, which is the numbering the user was looking at.
   */
  @JvmStatic
  public fun editPages(
    context: Context,
    file: File,
    output: File,
    operations: ReadableMap?,
  ): WritableMap {
    val started = System.nanoTime()

    val deleted = operations.intList("delete").toSet()
    val requestedOrder = operations.intList("order")
    val rotations = operations?.takeIf { it.hasKey("rotate") }?.getMap("rotate")

    load(context, file).use { source ->
      // An explicit order wins; anything it omits keeps its original position after the
      // pages it does mention, so a partial reorder is not a silent delete.
      val mentioned = requestedOrder.filter { it in 0 until source.numberOfPages }
      val order = mentioned + (0 until source.numberOfPages).filterNot { it in mentioned.toSet() }

      val edited = PDDocument()
      try {
        for (index in order) {
          if (index in deleted) continue
          val page = edited.importPage(source.getPage(index))
          val delta = rotations?.takeIf { it.hasKey("$index") }?.getDouble("$index")?.toInt()
          if (delta != null) {
            // Normalised into 0/90/180/270: readers are entitled to reject anything
            // else, and a negative rotation is a common way to say "anticlockwise".
            page.rotation = (((page.rotation + delta) % 360) + 360) % 360
          }
        }

        if (edited.numberOfPages == 0) {
          throw ConversionException.corrupt("That would delete every page.")
        }

        val temporary = File(output.parentFile, ".${UUID.randomUUID()}.pdf")
        try {
          edited.save(temporary)
          moveIntoPlace(temporary, output)
        } catch (error: IOException) {
          temporary.delete()
          throw ConversionException.diskFull()
        }

        return result(output, edited.numberOfPages, started)
      } finally {
        edited.close()
      }
    }
  }

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
      moveIntoPlace(temporary, output)
    } catch (error: IOException) {
      temporary.delete()
      throw ConversionException.diskFull()
    }
  }

  private fun moveIntoPlace(temporary: File, output: File) {
    if (output.exists()) output.delete()
    if (!temporary.renameTo(output)) {
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

/** Numbers cross the bridge as doubles even when they were written as integers. */
private fun ReadableMap?.intList(key: String): List<Int> {
  val array = this?.takeIf { it.hasKey(key) }?.getArray(key) ?: return emptyList()
  return (0 until array.size()).map { array.getDouble(it).toInt() }
}
