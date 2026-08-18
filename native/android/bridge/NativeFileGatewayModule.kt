// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.bridge

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import com.owaiskhan.converter.NativeFileGatewaySpec
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.annotations.ReactModule
import com.owaiskhan.converter.core.ConversionException
import com.owaiskhan.converter.core.FileGateway
import com.owaiskhan.converter.core.FormatDetector
import com.owaiskhan.converter.core.FormatMatcher
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

/**
 * Pickers, saving and the filesystem on Android.
 *
 * The photo picker is `ACTION_PICK_IMAGES` on API 33+ and the Storage Access Framework
 * below that. Both run out of process, so **no runtime permission is requested at any
 * point** — not `READ_MEDIA_IMAGES`, not `READ_EXTERNAL_STORAGE`. Saving goes through
 * MediaStore, which also needs none. That is why the manifest blocks those permissions
 * outright rather than merely not asking for them.
 */
@ReactModule(name = NativeFileGatewayModule.NAME)
public class NativeFileGatewayModule(
  private val reactContext: ReactApplicationContext,
) : NativeFileGatewaySpec(reactContext) {

  public companion object {
    public const val NAME: String = "NativeFileGateway"
    private const val REQUEST_PICK_PHOTOS = 0xC0DE
    private const val REQUEST_PICK_DOCUMENTS = 0xC0DF
  }

  private val executor = Executors.newFixedThreadPool(4)

  /** At most one picker can be open, so a single slot is the whole state machine. */
  private val pending = AtomicReference<Promise?>(null)

  private val activityListener: ActivityEventListener = object : BaseActivityEventListener() {
    override fun onActivityResult(
      activity: Activity,
      requestCode: Int,
      resultCode: Int,
      data: Intent?,
    ) {
      if (requestCode != REQUEST_PICK_PHOTOS && requestCode != REQUEST_PICK_DOCUMENTS) return
      val promise = pending.getAndSet(null) ?: return

      if (resultCode != Activity.RESULT_OK || data == null) {
        // Backing out of the picker is not an error; it is an empty selection.
        promise.resolve(Arguments.createArray())
        return
      }

      executor.execute {
        runCatching {
          val results = Arguments.createArray()
          for (uri in extractUris(data)) {
            val local = FileGateway.materialise(reactContext, uri)
            results.pushMap(FormatDetector.detect(local).toWritableMap())
          }
          results
        }
          .onSuccess(promise::resolve)
          .onFailure { promise.rejectConversion(it) }
      }
    }
  }

  init {
    reactContext.addActivityEventListener(activityListener)
  }

  private fun extractUris(data: Intent): List<Uri> {
    val clip = data.clipData
    if (clip != null) {
      return (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
    }
    return listOfNotNull(data.data)
  }

  // ------------------------------------------------------------------ pickers ---

  override fun pickPhotos(limit: Double, promise: Promise) {
    val activity = currentActivity
    if (activity == null) {
      promise.reject("unknown", "No activity is available to present the picker.")
      return
    }
    if (!pending.compareAndSet(null, promise)) {
      promise.reject("unknown", "A picker is already open.")
      return
    }

    val max = limit.toInt()
    val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      // The system Photo Picker: out of process, no permission, and the user sees only
      // what they choose to share.
      Intent(MediaStore.ACTION_PICK_IMAGES).apply {
        if (max != 1) {
          putExtra(
            MediaStore.EXTRA_PICK_IMAGES_MAX,
            if (max <= 0) MediaStore.getPickImagesMaxLimit() else max,
          )
        }
      }
    } else {
      // Storage Access Framework, which is also out of process and permission-free.
      Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "image/*"
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, max != 1)
      }
    }

    runCatching { activity.startActivityForResult(intent, REQUEST_PICK_PHOTOS) }
      .onFailure {
        pending.set(null)
        promise.rejectConversion(it)
      }
  }

  override fun pickDocuments(
    utisOrMimeTypes: ReadableArray,
    allowMultiple: Boolean,
    promise: Promise,
  ) {
    val activity = currentActivity
    if (activity == null) {
      promise.reject("unknown", "No activity is available to present the picker.")
      return
    }
    if (!pending.compareAndSet(null, promise)) {
      promise.reject("unknown", "A picker is already open.")
      return
    }

    // JavaScript sends one shared list of UTIs and MIME types; keep the MIME types and
    // drop the iOS identifiers rather than failing on them.
    val mimeTypes = (0 until utisOrMimeTypes.size())
      .mapNotNull { utisOrMimeTypes.getString(it) }
      .filter { it.contains('/') }
      .ifEmpty { FormatMatcher.allMimeTypes }

    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "*/*"
      putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toTypedArray())
      putExtra(Intent.EXTRA_ALLOW_MULTIPLE, allowMultiple)
    }

    runCatching { activity.startActivityForResult(intent, REQUEST_PICK_DOCUMENTS) }
      .onFailure {
        pending.set(null)
        promise.rejectConversion(it)
      }
  }

  // ------------------------------------------------------------------ storage ---

  /**
   * Android has no equivalent of iCloud placeholder files: the Storage Access Framework
   * streams from the provider, and `materialise` has already produced a local copy by
   * the time anything asks. So this resolves immediately rather than pretending to work.
   */
  override fun ensureLocal(uri: String, promise: Promise) {
    executor.execute {
      runCatching {
        when {
          uri.startsWith("content://") ->
            FileGateway.fileUri(FileGateway.materialise(reactContext, Uri.parse(uri)))
          else -> uri
        }
      }
        .onSuccess(promise::resolve)
        .onFailure { promise.rejectConversion(it) }
    }
  }

  override fun freeDiskSpace(promise: Promise) {
    promise.resolve(FileGateway.freeDiskSpace(reactContext).toDouble())
  }

  override fun saveToPhotos(uris: ReadableArray, promise: Promise) {
    executor.execute {
      runCatching {
        FileGateway.saveToPictures(reactContext, uris.toFiles())
        null
      }
        .onSuccess { promise.resolve(null) }
        .onFailure { promise.rejectConversion(it) }
    }
  }

  override fun saveToDownloads(uris: ReadableArray, promise: Promise) {
    executor.execute {
      runCatching {
        Arguments.fromList(FileGateway.saveToDownloads(reactContext, uris.toFiles()))
      }
        .onSuccess(promise::resolve)
        .onFailure { promise.rejectConversion(it) }
    }
  }

  override fun createZip(uris: ReadableArray, zipName: String, promise: Promise) {
    executor.execute {
      runCatching {
        FileGateway.fileUri(FileGateway.createZip(reactContext, uris.toFiles(), zipName))
      }
        .onSuccess(promise::resolve)
        .onFailure { promise.rejectConversion(it) }
    }
  }

  override fun sanitiseFilename(name: String): String = FileGateway.sanitise(name)

  override fun resolveCollision(directory: String, filename: String, promise: Promise) {
    executor.execute {
      runCatching {
        FileGateway.fileUri(
          FileGateway.resolveCollision(
            FileGateway.fileFromUri(directory),
            FileGateway.sanitise(filename),
          ),
        )
      }
        .onSuccess(promise::resolve)
        .onFailure { promise.rejectConversion(it) }
    }
  }

  override fun clearTemporaryFiles(promise: Promise) {
    executor.execute {
      runCatching { FileGateway.clearTemporaryFiles(reactContext) }
        .onSuccess { promise.resolve(null) }
        .onFailure { promise.rejectConversion(it) }
    }
  }

  private fun ReadableArray.toFiles(): List<File> =
    (0 until size()).mapNotNull { index ->
      val value = getString(index) ?: return@mapNotNull null
      if (value.startsWith("content://")) {
        FileGateway.materialise(reactContext, Uri.parse(value))
      } else {
        FileGateway.fileFromUri(value)
      }
    }.also {
      if (it.isEmpty()) throw ConversionException.unreadable("the selected files")
    }

  override fun invalidate() {
    reactContext.removeActivityEventListener(activityListener)
    executor.shutdownNow()
    super.invalidate()
  }
}
