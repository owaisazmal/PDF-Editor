// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.core

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * Files handed to the app from outside it.
 *
 * Three doors lead here and they all look the same once opened: a share from another
 * app's share sheet, an Open With on a file, and — later — a drop onto the window. Each
 * arrives as an `Intent` carrying one or more content URIs, and each has to end up as the
 * same `DetectedFile` list the pickers produce, because everything downstream was written
 * against that and should not learn where a file came from.
 *
 * The queue exists for cold starts. A share that launches the app arrives before the
 * JavaScript runtime does, so there is nobody to emit to; the intent is parked here and
 * drained when the UI asks. That is the normal case for a share, not the exception.
 */
public object ReceivedFiles {

  /**
   * Marks an intent as already dealt with.
   *
   * `Activity.getIntent()` keeps returning the launching intent forever, so without this
   * every reload — and every trip back to the home screen — would resurrect a share the
   * user has already finished with.
   */
  private const val CONSUMED_EXTRA: String = "com.owaiskhan.converter.received.consumed"

  private val queue = ConcurrentLinkedQueue<Uri>()

  /**
   * Extracts whatever an intent carries, and reports whether it carried anything.
   *
   * The caller uses that answer to decide whether to notify a running app; nothing here
   * touches the filesystem, because this runs on whichever thread delivered the intent
   * and reading a content URI is not free.
   */
  @JvmStatic
  public fun offer(intent: Intent?): Boolean {
    if (intent == null) return false
    if (intent.getBooleanExtra(CONSUMED_EXTRA, false)) return false

    val uris = extract(intent)
    // Marked even when empty: an intent with nothing usable in it should be examined
    // once, not on every resume for the life of the activity.
    intent.putExtra(CONSUMED_EXTRA, true)
    if (uris.isEmpty()) return false

    queue.addAll(uris)
    return true
  }

  /**
   * Drains the queue into detected files.
   *
   * Content URIs are copied into the app's own storage first. A URI from a share is
   * granted only for the life of the activity that received it, so a file left as a URI
   * would stop being readable at the worst possible moment — usually part-way through a
   * batch the user has walked away from.
   */
  @JvmStatic
  public fun take(context: Context): WritableArray {
    val files = Arguments.createArray()

    while (true) {
      val uri = queue.poll() ?: break
      // A file that cannot be read is dropped rather than failing the whole share: one
      // unreadable item out of twelve should cost that item, not the other eleven.
      val detected = runCatching {
        val file = if (uri.scheme == "content") {
          FileGateway.materialise(context, uri)
        } else {
          FileGateway.fileFromUri(uri.toString())
        }
        FormatDetector.detect(file)
      }.getOrNull() ?: continue

      files.pushMap(detected.toWritableMap())
    }

    return files
  }

  /** True when anything is waiting. Used to decide whether a screen is worth showing. */
  @JvmStatic
  public fun hasPending(): Boolean = queue.isNotEmpty()

  @JvmStatic
  public fun clear() {
    queue.clear()
  }

  // ------------------------------------------------------------------ parsing --

  /**
   * Every URI an intent carries, from all three places it can put them.
   *
   * `clipData` is not an alternative to `EXTRA_STREAM` — it is where the read permission
   * actually lives. `FLAG_GRANT_READ_URI_PERMISSION` applies to an intent's data and its
   * clip, never to a bare parcelable extra, so an app that reads only the extra can end
   * up holding a URI it is not allowed to open. Reading both, and de-duplicating, is what
   * makes a share from an arbitrary app work rather than only the ones that happen to
   * populate the field we looked at.
   */
  private fun extract(intent: Intent): List<Uri> = buildList {
    when (intent.action) {
      Intent.ACTION_SEND -> stream(intent)?.let(::add)
      Intent.ACTION_SEND_MULTIPLE -> addAll(streams(intent))
      // Open With hands over a single file as the intent's data rather than an extra.
      Intent.ACTION_VIEW, Intent.ACTION_EDIT -> intent.data?.let(::add)
      else -> Unit
    }

    val clip = intent.clipData
    if (clip != null) {
      for (index in 0 until clip.itemCount) {
        clip.getItemAt(index).uri?.let(::add)
      }
    }
  }
    .filter { it.scheme == "content" || it.scheme == "file" }
    .distinct()

  @Suppress("DEPRECATION")
  private fun stream(intent: Intent): Uri? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      intent.getParcelableExtra(Intent.EXTRA_STREAM)
    }

  @Suppress("DEPRECATION")
  private fun streams(intent: Intent): List<Uri> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
    } else {
      intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
    }
}
