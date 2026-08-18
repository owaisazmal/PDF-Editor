// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.core

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.MediaStore
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Files, saving and archiving on Android.
 *
 * Everything here goes through scoped storage: the Photo Picker and the Storage Access
 * Framework for reading, MediaStore for writing. `MANAGE_EXTERNAL_STORAGE` is never
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

  /** Scratch space for picker copies and previews. Safe to clear at any time. */
  public fun temporaryDirectory(context: Context): File =
    File(context.cacheDir, "ConverterWork").apply { mkdirs() }

  public fun clearTemporaryFiles(context: Context) {
    temporaryDirectory(context).deleteRecursively()
    temporaryDirectory(context)
  }

  public fun freeDiskSpace(context: Context): Long =
    StatFs(context.filesDir.absolutePath).availableBytes

  /**
   * Copies a content URI into app storage so the rest of the engine deals in plain
   * files. Content URIs are revocable and not seekable in general; a local copy is
   * both simpler and what atomic output requires.
   */
  public fun materialise(context: Context, uri: Uri): File {
    val name = displayName(context, uri) ?: "file"
    val destination = File(temporaryDirectory(context), sanitise(name))

    context.contentResolver.openInputStream(uri)?.use { input ->
      destination.outputStream().use { output -> input.copyTo(output) }
    } ?: throw ConversionException.unreadable(name)

    return destination
  }

  private fun displayName(context: Context, uri: Uri): String? {
    if (uri.scheme == "file") return uri.lastPathSegment
    context.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)
      ?.use { cursor ->
        if (cursor.moveToFirst()) return cursor.getString(0)
      }
    return uri.lastPathSegment
  }

  /**
   * Writes converted images into the shared Pictures collection through MediaStore.
   *
   * No runtime permission is needed on API 29 and above: an app may always insert its
   * own media. `IS_PENDING` keeps the entry invisible to other apps until the bytes are
   * fully written, which is the MediaStore equivalent of the atomic rename used for
   * app-private output.
   */
  public fun saveToPictures(context: Context, files: List<File>): List<String> =
    files.map { file ->
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
        put(MediaStore.MediaColumns.MIME_TYPE, mimeTypeFor(file))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/Converter")
          put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
      }

      val resolver = context.contentResolver
      val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
        ?: throw ConversionException.permissionDenied()

      resolver.openOutputStream(uri)?.use { output ->
        file.inputStream().use { input -> input.copyTo(output) }
      } ?: throw ConversionException.diskFull()

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
      }
      uri.toString()
    }

  /** The same pattern against the Downloads collection. */
  public fun saveToDownloads(context: Context, files: List<File>): List<String> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      // Below API 29 there is no MediaStore.Downloads; the share sheet is the path.
      throw ConversionException.unsupportedTarget("Downloads on this Android version")
    }
    return files.map { file ->
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
        put(MediaStore.MediaColumns.MIME_TYPE, mimeTypeFor(file))
        put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/Converter")
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
  public fun resolveCollision(directory: File, filename: String): File {
    directory.mkdirs()
    val base = filename.substringBeforeLast('.', filename)
    val ext = filename.substringAfterLast('.', "")

    var candidate = File(directory, filename)
    var suffix = 1
    while (candidate.exists()) {
      val next = if (ext.isEmpty()) "$base ($suffix)" else "$base ($suffix).$ext"
      candidate = File(directory, next)
      suffix++
    }
    return candidate
  }

  private fun mimeTypeFor(file: File): String {
    val ext = file.extension.lowercase()
    val id = FormatMatcher.formatIdForFilename(file.name)
    return id?.let { FormatMatcher.spec(it)?.mimeTypes?.firstOrNull() }
      ?: "image/$ext"
  }
}
