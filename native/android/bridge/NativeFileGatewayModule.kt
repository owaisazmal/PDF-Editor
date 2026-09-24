// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.bridge

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import com.owaiskhan.converter.NativeFileGatewaySpec
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.annotations.ReactModule
import com.owaiskhan.converter.core.ConversionException
import com.owaiskhan.converter.core.FileGateway
import com.owaiskhan.converter.core.FormatDetector
import com.owaiskhan.converter.core.DropTarget
import com.owaiskhan.converter.core.FormatMatcher
import com.owaiskhan.converter.core.ReceivedFiles
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

/**
 * Pickers, saving and the filesystem on Android.
 *
 * The photo picker is `ACTION_PICK_IMAGES` on API 33+ and the Storage Access Framework
 * below that. Both run out of process, so **no runtime permission is requested at any
 * point** — not `READ_MEDIA_IMAGES`, not `READ_EXTERNAL_STORAGE`. Saving goes through
 * MediaStore, which also needs none from API 29. Below that MediaStore writes need the
 * storage permission, so saves go through the Storage Access Framework's create and
 * folder pickers instead. That is why the manifest blocks those permissions
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
    private const val REQUEST_SAVE_DOCUMENT = 0xC0E0
    private const val REQUEST_SAVE_FOLDER = 0xC0E1

    /** Where the save pickers open: the primary volume's Download or Pictures folder. */
    private val DOWNLOADS_DOCUMENT: Uri = primaryFolder(Environment.DIRECTORY_DOWNLOADS)
    private val PICTURES_DOCUMENT: Uri = primaryFolder(Environment.DIRECTORY_PICTURES)

    private fun primaryFolder(name: String): Uri =
      DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:$name")
  }

  private val executor = Executors.newFixedThreadPool(4)

  /** At most one picker can be open, so a single slot is the whole state machine. */
  private val pending = AtomicReference<Promise?>(null)

  /**
   * A save waiting on the user to choose where it goes (API 26-28 only). `answer` turns
   * the saved URIs into what the calling method promises; empty means they backed out.
   */
  private class PendingSave(
    val promise: Promise,
    val uris: List<String>,
    val answer: (List<String>) -> Any,
  )
  private val pendingSave = AtomicReference<PendingSave?>(null)

  private val activityListener: ActivityEventListener = object : BaseActivityEventListener() {
    override fun onActivityResult(
      activity: Activity,
      requestCode: Int,
      resultCode: Int,
      data: Intent?,
    ) {
      if (requestCode == REQUEST_SAVE_DOCUMENT || requestCode == REQUEST_SAVE_FOLDER) {
        finishSave(requestCode, resultCode, data)
        return
      }
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
          val directory = FileGateway.pickDirectory(reactContext)
          for (uri in extractUris(data)) {
            val local = FileGateway.materialise(reactContext, uri, directory)
            results.pushMap(FormatDetector.detect(local).toWritableMap())
          }
          results
        }
          .onSuccess(promise::resolve)
          .onFailure { promise.rejectConversion(it) }
      }
    }
  }

  /**
   * A share arriving at an app that is already running.
   *
   * The activity is `singleTask`, so a second share does not start a second copy — it is
   * delivered here instead, and the UI has to be told, because nothing is going to ask.
   *
   * Declared before `init`, which is not a style choice: Kotlin initialises properties in
   * source order, so a listener declared after it would still be null when `init` tried
   * to register it.
   */
  private val incomingListener: ActivityEventListener = object : BaseActivityEventListener() {
    override fun onNewIntent(intent: Intent) {
      if (!ReceivedFiles.offer(intent)) return
      // Only a nudge: the payload is fetched with `takePendingFiles`, on a background
      // thread, because materialising a content URI reads the whole file.
      emitOnFilesReceived(Arguments.createMap())
    }
  }

  /**
   * Installs the drop target once there is a window to install it on.
   *
   * Resume rather than construction: this module is built eagerly at startup, before the
   * activity has a content view, and the activity can be recreated under it at any point.
   */
  private val lifecycleListener: LifecycleEventListener = object : LifecycleEventListener {
    override fun onHostResume() {
      val activity = currentActivity ?: return
      DropTarget.install(activity) { emitOnFilesReceived(Arguments.createMap()) }
    }

    override fun onHostPause() = Unit
    override fun onHostDestroy() = Unit
  }

  init {
    reactContext.addActivityEventListener(activityListener)
    reactContext.addActivityEventListener(incomingListener)
    reactContext.addLifecycleEventListener(lifecycleListener)
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

  /** Resolves `false` only when the user backs out of the Android 8-9 destination picker. */
  override fun saveToPhotos(uris: ReadableArray, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      chooseSaveDestination(uris.toStrings(), PICTURES_DOCUMENT, promise) { it.isNotEmpty() }
      return
    }
    executor.execute {
      runCatching { FileGateway.saveToPictures(reactContext, uris.toFiles()) }
        .onSuccess { promise.resolve(true) }
        .onFailure { promise.rejectConversion(it) }
    }
  }

  override fun saveToDownloads(uris: ReadableArray, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      chooseSaveDestination(uris.toStrings(), DOWNLOADS_DOCUMENT, promise) { Arguments.fromList(it) }
      return
    }
    executor.execute {
      runCatching {
        Arguments.fromList(FileGateway.saveToDownloads(reactContext, uris.toFiles()))
      }
        .onSuccess(promise::resolve)
        .onFailure { promise.rejectConversion(it) }
    }
  }

  /**
   * Android 8 and 9 have no MediaStore.Downloads, and writing to the shared Pictures or
   * Download folders needs a storage permission the manifest blocks. So the user chooses:
   * one file gets the system "save as" screen, several get a folder picker. Both open on
   * `initialFolder`.
   */
  private fun chooseSaveDestination(
    uris: List<String>,
    initialFolder: Uri,
    promise: Promise,
    answer: (List<String>) -> Any,
  ) {
    val activity = currentActivity
    if (activity == null) {
      promise.reject("unknown", "No activity is available to present the picker.")
      return
    }
    if (uris.isEmpty()) {
      promise.rejectConversion(ConversionException.unreadable("the selected files"))
      return
    }
    if (!pendingSave.compareAndSet(null, PendingSave(promise, uris, answer))) {
      promise.reject("unknown", "A save is already waiting for a destination.")
      return
    }

    val single = uris.singleOrNull()?.takeUnless { it.startsWith("content://") }
      ?.let(FileGateway::fileFromUri)
    val (intent, requestCode) = if (single != null) {
      Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = FileGateway.mimeTypeFor(single)
        putExtra(Intent.EXTRA_TITLE, single.name)
      } to REQUEST_SAVE_DOCUMENT
    } else {
      Intent(Intent.ACTION_OPEN_DOCUMENT_TREE) to REQUEST_SAVE_FOLDER
    }
    intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, initialFolder)
    // Android 8 and 9 hide internal storage in these pickers until this is set, which
    // leaves a folder pick with nowhere useful to go.
    intent.putExtra("android.content.extra.SHOW_ADVANCED", true)

    runCatching { activity.startActivityForResult(intent, requestCode) }
      .onFailure {
        pendingSave.set(null)
        promise.rejectConversion(it)
      }
  }

  private fun finishSave(requestCode: Int, resultCode: Int, data: Intent?) {
    val save = pendingSave.getAndSet(null) ?: return
    val destination = data?.data
    if (resultCode != Activity.RESULT_OK || destination == null) {
      // Backing out is not a save, and not an error either, as with the iOS export sheet.
      save.promise.resolve(save.answer(emptyList()))
      return
    }

    executor.execute {
      runCatching {
        val files = save.uris.toFiles()
        save.answer(
          if (requestCode == REQUEST_SAVE_DOCUMENT) {
            listOf(FileGateway.saveToDocument(reactContext, files.first(), destination))
          } else {
            FileGateway.saveToTree(reactContext, files, destination)
          },
        )
      }
        .onSuccess(save.promise::resolve)
        .onFailure { save.promise.rejectConversion(it) }
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

  override fun takePendingFiles(promise: Promise) {
    // The launching intent is examined here rather than in `init`, because a cold start
    // from a share constructs this module before the activity has one to give.
    ReceivedFiles.offer(currentActivity?.intent)

    executor.execute {
      runCatching { ReceivedFiles.take(reactContext) }
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

  private fun ReadableArray.toStrings(): List<String> =
    (0 until size()).mapNotNull { getString(it) }

  private fun ReadableArray.toFiles(): List<File> = toStrings().toFiles()

  private fun List<String>.toFiles(): List<File> =
    map { value ->
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
