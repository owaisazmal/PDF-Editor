// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.core

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.DocumentsContract
import android.provider.MediaStore
import androidx.exifinterface.media.ExifInterface
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Files, saving and archiving on Android.
 *
 * Everything here goes through scoped storage: the Photo Picker and the Storage Access
 * Framework for reading, MediaStore for writing (the Storage Access Framework again for
 * documents below API 29, which has no Downloads collection). `MANAGE_EXTERNAL_STORAGE` is never
 * requested — Google Play rejects apps that ask for it without a qualifying use, and
 * this app has no need for it.
 *
 * Archiving uses `java.util.zip` from the JDK rather than a third-party archiver, so
 * there is no dependency and nothing extra for the licence gate to audit.
 */
public object FileGateway {

  /**
   * The canonical file URI form.
   *
   * `File.toURI()` produces `file:/path` with a single slash, which is legal but not
   * what anything else in this codebase expects — and a `startsWith("file://")` check
   * against it silently fails, which is exactly the bug this helper exists to prevent.
   * Everything that hands a path across the bridge goes through here.
   */
  public fun fileUri(file: File): String = "file://" + file.absolutePath

  /** Accepts `file://`, `file:/`, and bare paths, because all three arrive in practice. */
  public fun fileFromUri(uri: String): File = when {
    uri.startsWith("file://") -> File(uri.removePrefix("file://"))
    uri.startsWith("file:") -> File(uri.removePrefix("file:"))
    else -> File(uri)
  }

  /** Where converted files live before the user does anything with them. */
  public fun outputDirectory(context: Context): File =
    File(context.filesDir, "ConvertedFiles").apply { mkdirs() }

  /**
   * Scratch space for picker copies, shared files and decrypted PDFs. Not in `cacheDir`,
   * which Android empties on low storage, between a pick and its conversion.
   */
  public fun temporaryDirectory(context: Context): File =
    File(context.noBackupFilesDir, "ConverterWork").apply { mkdirs() }

  /** A folder per pick, so picking the same photo again keeps its name. */
  public fun pickDirectory(context: Context): File =
    File(temporaryDirectory(context), java.util.UUID.randomUUID().toString()).apply { mkdirs() }

  /** Paths handed out by [resolveCollision] that may not exist on disk yet. */
  private val reserved = HashSet<String>()

  /**
   * Throws away what earlier runs wrote and the user did not save. Only files older than
   * this process, so a share that cold-starts the app keeps the copies it is making.
   */
  public fun clearTemporaryFiles(context: Context) {
    File(context.cacheDir, "ConverterWork").deleteRecursively()

    val cutoff = processStartMillis()
    for (directory in listOf(temporaryDirectory(context), outputDirectory(context))) {
      directory.listFiles()
        ?.filter { it.lastModified() < cutoff }
        ?.forEach { it.deleteRecursively() }
    }
  }

  /**
   * Deletes copies the UI has finished with. Only files inside the app's own work and
   * output folders are touched, so a user's original is never at risk.
   */
  public fun discard(context: Context, uris: List<String>) {
    val work = temporaryDirectory(context).canonicalFile
    val roots = listOf(work, outputDirectory(context).canonicalFile)

    for (uri in uris) {
      if (uri.startsWith("content:")) continue
      val given = fileFromUri(uri)
      val file = runCatching { given.canonicalFile }.getOrNull() ?: continue
      if (roots.none { file.path.startsWith(it.path + File.separator) }) continue

      file.delete()
      synchronized(reserved) { reserved.remove(given.absolutePath) }
      // The folder a pick made goes once its last file does; delete() refuses a non-empty one.
      val parent = file.parentFile
      if (parent != null && parent.parentFile == work) parent.delete()
    }
  }

  private fun processStartMillis(): Long =
    System.currentTimeMillis() -
      (android.os.SystemClock.elapsedRealtime() - android.os.Process.getStartElapsedRealtime())

  public fun freeDiskSpace(context: Context): Long =
    StatFs(context.filesDir.absolutePath).availableBytes

  /**
   * Copies a content URI into app storage so the rest of the engine deals in plain
   * files. Content URIs are revocable and not seekable in general; a local copy is
   * both simpler and what atomic output requires.
   */
  public fun materialise(
    context: Context,
    uri: Uri,
    directory: File = temporaryDirectory(context),
  ): File {
    val name = displayName(context, uri) ?: "file"
    // Two picked files can share a name; a fixed path let the second replace the first.
    val destination = resolveCollision(directory, sanitise(name))

    try {
      context.contentResolver.openInputStream(uri)?.use { input ->
        destination.outputStream().use { output -> input.copyTo(output) }
      } ?: throw ConversionException.unreadable(name)
    } catch (error: java.io.IOException) {
      destination.delete()
      throw if (freeDiskSpace(context) < 16L * 1024 * 1024) {
        ConversionException.diskFull()
      } else {
        ConversionException.unreadable(name)
      }
    }

    return destination
  }

  private fun displayName(context: Context, uri: Uri): String? {
    if (uri.scheme == "file") return uri.lastPathSegment
    val name = queryColumn(context, uri, MediaStore.MediaColumns.DISPLAY_NAME) { getString(it) }
      ?: uri.lastPathSegment
    return if (isPhotoPickerUri(uri)) photoPickerName(context, uri, name) else name
  }

  private fun isPhotoPickerUri(uri: Uri): Boolean =
    uri.authority == MediaStore.AUTHORITY && uri.pathSegments.firstOrNull()?.startsWith("picker") == true

  /**
   * The photo picker names files by media id ("1115.jpg"); the real name needs a storage
   * permission this app never asks for, so a photo is named from when it was taken.
   */
  private fun photoPickerName(context: Context, uri: Uri, name: String?): String? {
    val stem = name?.substringBeforeLast('.') ?: return name
    if (stem.isEmpty() || !stem.all(Char::isDigit)) return name
    // The camera's own time first: for a photo copied from elsewhere, the picker's date
    // is when the copy was made.
    val stamp = exifStamp(context, uri)
      ?: queryColumn(context, uri, MediaStore.MediaColumns.DATE_TAKEN) { getLong(it) }
        ?.takeIf { it > 0 }
        ?.let { SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date(it)) }
      ?: return name
    val ext = name.substringAfterLast('.', "")
    return if (ext.isEmpty()) "IMG_$stamp" else "IMG_$stamp.$ext"
  }

  /** The camera's own "2026:09:13 14:03:05", reshaped to "20260913_140305". */
  private fun exifStamp(context: Context, uri: Uri): String? {
    val written = runCatching {
      context.contentResolver.openInputStream(uri)?.use { input ->
        val exif = ExifInterface(input)
        exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL) ?: exif.getAttribute(ExifInterface.TAG_DATETIME)
      }
    }.getOrNull() ?: return null
    val (year, month, day, hour, minute, second) =
      EXIF_DATE.find(written)?.destructured ?: return null
    return "$year$month${day}_$hour$minute$second"
  }

  private val EXIF_DATE = Regex("""(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})""")

  private fun <T> queryColumn(context: Context, uri: Uri, column: String, read: Cursor.(Int) -> T): T? =
    runCatching {
      context.contentResolver.query(uri, arrayOf(column), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.read(0) else null
      }
    }.getOrNull()

  /**
   * Writes converted images into the shared Pictures collection through MediaStore.
   *
   * API 29 and above only: there an app may always insert its own media with no runtime
   * permission. Below that the insert needs `WRITE_EXTERNAL_STORAGE`, which the manifest
   * blocks, so the bridge saves through [saveToDocument] or [saveToTree] instead.
   * `IS_PENDING` keeps the entry invisible to other apps until the bytes are fully
   * written, which is the MediaStore equivalent of the atomic rename used for app-private
   * output.
   */
  public fun saveToPictures(context: Context, files: List<File>): List<String> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      throw ConversionException.unsupportedTarget("Pictures on this Android version")
    }
    return files.map { file ->
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
        put(MediaStore.MediaColumns.MIME_TYPE, mimeTypeFor(file))
        put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/Kitefold")
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }

      val resolver = context.contentResolver
      val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
        ?: throw ConversionException.permissionDenied()

      resolver.openOutputStream(uri)?.use { output ->
        file.inputStream().use { input -> input.copyTo(output) }
      } ?: throw ConversionException.diskFull()

      resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
      uri.toString()
    }
  }

  /**
   * The same pattern against the Downloads collection. API 29 and above only: below that
   * there is no MediaStore.Downloads, and the bridge saves through [saveToDocument] or
   * [saveToTree] instead.
   */
  public fun saveToDownloads(context: Context, files: List<File>): List<String> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      throw ConversionException.unsupportedTarget("Downloads on this Android version")
    }
    return files.map { file ->
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
        put(MediaStore.MediaColumns.MIME_TYPE, mimeTypeFor(file))
        put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/Kitefold")
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }

      val resolver = context.contentResolver
      val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        ?: throw ConversionException.permissionDenied()

      resolver.openOutputStream(uri)?.use { output ->
        file.inputStream().use { input -> input.copyTo(output) }
      } ?: throw ConversionException.diskFull()

      resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
      uri.toString()
    }
  }

  /**
   * Writes one file into a document the user created with `ACTION_CREATE_DOCUMENT`.
   *
   * This and [saveToTree] are the API 26-28 save path. Writing to the public Downloads
   * folder there needs `WRITE_EXTERNAL_STORAGE`, which the manifest blocks; the Storage
   * Access Framework needs nothing, because the user picks the destination and the grant
   * comes with the pick.
   */
  public fun saveToDocument(context: Context, file: File, destination: Uri): String {
    try {
      copyInto(context, file, destination)
    } catch (error: Throwable) {
      // The picker already created the entry; an empty file left in Downloads is worse
      // than none.
      runCatching { DocumentsContract.deleteDocument(context.contentResolver, destination) }
      throw error
    }
    return destination.toString()
  }

  /**
   * Writes every file into a folder the user picked with `ACTION_OPEN_DOCUMENT_TREE`, so
   * a split into hundreds of parts is one pick rather than hundreds. The provider appends
   * " (1)" to a name that is taken, the same rule as [resolveCollision].
   */
  public fun saveToTree(context: Context, files: List<File>, tree: Uri): List<String> {
    val resolver = context.contentResolver
    val folder = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
    return files.map { file ->
      val document = DocumentsContract.createDocument(resolver, folder, mimeTypeFor(file), file.name)
        ?: throw ConversionException.permissionDenied()
      saveToDocument(context, file, document)
    }
  }

  private fun copyInto(context: Context, file: File, destination: Uri) {
    context.contentResolver.openOutputStream(destination, "w")?.use { output ->
      file.inputStream().use { input -> input.copyTo(output) }
    } ?: throw ConversionException.diskFull()
  }

  /** Streams a zip with the JDK's own writer. Nothing is held in memory. */
  public fun createZip(context: Context, files: List<File>, zipName: String): File {
    val safeName = sanitise(zipName.ifEmpty { "Converted" })
    val output = resolveCollision(outputDirectory(context), "$safeName.zip")

    ZipOutputStream(output.outputStream().buffered()).use { zip ->
      val used = mutableSetOf<String>()
      for (file in files) {
        if (!file.exists()) continue
        // Entry names must be unique inside the archive even when two inputs share a
        // filename, so the same collision rule applies here as on disk.
        var entryName = file.name
        var suffix = 1
        while (!used.add(entryName)) {
          entryName = "${file.nameWithoutExtension} ($suffix).${file.extension}"
          suffix++
        }
        zip.putNextEntry(ZipEntry(entryName))
        file.inputStream().use { it.copyTo(zip) }
        zip.closeEntry()
      }
    }
    return output
  }

  /**
   * Makes a name safe for the filesystem without mangling it.
   *
   * Emoji and right-to-left text survive — they are legal in a filename, and stripping
   * them is the kind of "sanitising" that makes a user's file unrecognisable. Only
   * genuinely reserved characters are replaced, and the length cap counts UTF-8 bytes
   * against the 255-byte limit while trimming on a character boundary.
   */
  public fun sanitise(name: String): String {
    var cleaned = name.map { if (it in RESERVED || it.code == 0) '_' else it }
      .joinToString("")
      .trim()

    // A leading dot hides the file on every Unix filesystem.
    cleaned = cleaned.trimStart('.')
    if (cleaned.isEmpty()) cleaned = "file"

    // Leave headroom for an extension and a " (12)" collision suffix.
    val maxBytes = 200
    while (cleaned.toByteArray(Charsets.UTF_8).size > maxBytes && cleaned.isNotEmpty()) {
      cleaned = cleaned.dropLast(1)
    }
    return cleaned
  }

  private val RESERVED = charArrayOf('/', '\\', ':', '*', '?', '"', '<', '>', '|')

  /** Appends " (1)", " (2)" until the name is free. Never overwrites. */
  public fun resolveCollision(directory: File, filename: String): File = synchronized(reserved) {
    directory.mkdirs()
    val base = filename.substringBeforeLast('.', filename)
    val ext = filename.substringAfterLast('.', "")

    // Reserved as well as checked: concurrent outputs with one name overwrote each other.
    if (reserved.size > 512) reserved.removeAll { File(it).exists() }
    var candidate = File(directory, filename)
    var suffix = 1
    while (candidate.exists() || !reserved.add(candidate.absolutePath)) {
      val next = if (ext.isEmpty()) "$base ($suffix)" else "$base ($suffix).$ext"
      candidate = File(directory, next)
      suffix++
    }
    return candidate
  }

  public fun mimeTypeFor(file: File): String {
    val ext = file.extension.lowercase()
    val id = FormatMatcher.formatIdForFilename(file.name)
    return id?.let { FormatMatcher.spec(it)?.mimeTypes?.firstOrNull() }
      ?: "image/$ext"
  }
}
