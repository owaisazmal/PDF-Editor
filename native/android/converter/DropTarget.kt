// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.core

import android.app.Activity
import android.content.ClipData
import android.content.ClipDescription
import android.net.Uri
import android.view.DragEvent
import android.view.View
import java.lang.ref.WeakReference

/**
 * Images and PDFs dropped onto the window.
 *
 * The third door into `ReceivedFiles`, and deliberately the same door once opened: a drop
 * ends as the same detected files a share produces, and reaches the same screen. Drag and
 * drop is mostly a large-screen and multi-window gesture on Android, which is exactly
 * where a converter earns its place — one window holding files, another converting them.
 */
public object DropTarget {

  /** The view currently carrying the listener, so it is not installed twice. */
  private var installed = WeakReference<View>(null)

  /**
   * Installs the drop listener on the activity's content view.
   *
   * Idempotent, and safe to call on every resume: a second listener on the same view
   * would replace the first rather than stack, but the check keeps the intent clear and
   * survives the activity being recreated with a new view.
   */
  @JvmStatic
  public fun install(activity: Activity, onArrival: () -> Unit) {
    val root = activity.window?.decorView?.findViewById<View>(android.R.id.content) ?: return
    if (installed.get() === root) return
    installed = WeakReference(root)

    root.setOnDragListener { _, event -> handle(activity, event, onArrival) }
  }

  private fun handle(activity: Activity, event: DragEvent, onArrival: () -> Unit): Boolean =
    when (event.action) {
      // Answering false here removes the app from the drag entirely, so the description
      // is the only chance to decline something this app cannot read.
      DragEvent.ACTION_DRAG_STARTED -> accepts(event.clipDescription)

      DragEvent.ACTION_DROP -> {
        // A dropped URI belongs to the sending app and is unreadable without this. The
        // grant is deliberately not released: the files are materialised a moment later
        // on a background thread, and releasing here would revoke access before that
        // happens. Android drops it when the activity is destroyed, which is the right
        // lifetime for it.
        activity.requestDragAndDropPermissions(event)

        val added = ReceivedFiles.offer(uris(event.clipData))
        if (added) onArrival()
        added
      }

      else -> true
    }

  private fun accepts(description: ClipDescription?): Boolean {
    val types = description ?: return false
    for (index in 0 until types.mimeTypeCount) {
      val mimeType = types.getMimeType(index)
      if (mimeType.startsWith("image/") || mimeType == "application/pdf") return true
    }
    return false
  }

  private fun uris(clip: ClipData?): List<Uri> {
    val data = clip ?: return emptyList()
    return (0 until data.itemCount).mapNotNull { data.getItemAt(it).uri }
  }
}
