// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.bridge

import android.Manifest
import android.content.pm.PackageManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.PermissionAwareActivity
import com.owaiskhan.converter.NativeJobQueueSpec
import com.owaiskhan.converter.core.BackgroundProgress
import com.owaiskhan.converter.core.JobQueue
import com.owaiskhan.converter.core.JobSpec

/**
 * TurboModule surface for the batch queue. Pure forwarding — the scheduling, the
 * cancellation and the memory ceiling all live in `JobQueue`, which is testable without
 * React Native in the loop.
 */
@ReactModule(name = NativeJobQueueModule.NAME)
public class NativeJobQueueModule(
  private val reactContext: ReactApplicationContext,
) : NativeJobQueueSpec(reactContext) {

  public companion object {
    public const val NAME: String = "NativeJobQueue"

    /** Arbitrary, and only has to be unique among this app's own requests. */
    private const val NOTIFICATION_REQUEST_CODE: Int = 8021
  }

  private val sink = object : JobQueue.Events {
    override fun onProgress(payload: WritableMap): Unit = emitOnProgress(payload)
    override fun onFileComplete(payload: WritableMap): Unit = emitOnFileComplete(payload)
    override fun onFileFailed(payload: WritableMap): Unit = emitOnFileFailed(payload)
    override fun onJobComplete(payload: WritableMap): Unit = emitOnJobComplete(payload)
  }

  init {
    JobQueue.setEvents(sink)
    // Handed over here rather than fetched inside the queue, so the queue itself stays
    // free of React Native and remains testable without it.
    JobQueue.attach(reactContext)
  }

  override fun submit(spec: ReadableMap, promise: Promise) {
    val parsed = JobSpec.from(reactContext, spec)
    if (parsed == null) {
      promise.reject("unknown", "The job specification was missing a jobId or was malformed.")
      return
    }
    // Returns immediately: everything observable about the job arrives as an event.
    JobQueue.submit(parsed)
    promise.resolve(null)
  }

  override fun cancel(jobId: String, promise: Promise) {
    // Resolves once the queue has drained, so "cancelled" means nothing is still
    // writing to disk.
    JobQueue.cancel(jobId) { promise.resolve(null) }
  }

  override fun getState(jobId: String, promise: Promise) {
    promise.resolve(JobQueue.state(jobId))
  }

  override fun retryFailed(jobId: String, promise: Promise) {
    JobQueue.retryFailed(jobId)
    promise.resolve(null)
  }

  override fun release(jobId: String) {
    JobQueue.release(jobId)
  }

  override fun backgroundProgressStatus(promise: Promise) {
    promise.resolve(BackgroundProgress.status(reactContext))
  }

  override fun requestBackgroundProgress(promise: Promise) {
    val current = BackgroundProgress.status(reactContext)
    if (current != BackgroundProgress.DENIED) {
      // Already granted, or already refused. Android silently ignores a second ask
      // anyway, and a user experiences a repeated one as nagging.
      promise.resolve(current)
      return
    }

    val activity = reactContext.currentActivity as? PermissionAwareActivity
    if (activity == null) {
      // No window to present a dialog over. Reported as still askable, so the next
      // batch started with the app on screen asks properly.
      promise.resolve(BackgroundProgress.DENIED)
      return
    }

    // Recorded before the dialog rather than after it, so an activity torn down
    // mid-prompt cannot leave the app asking again on every batch.
    BackgroundProgress.markAsked(reactContext)

    activity.requestPermissions(
      arrayOf(Manifest.permission.POST_NOTIFICATIONS),
      NOTIFICATION_REQUEST_CODE,
    ) { _, _, results ->
      val granted = results.isNotEmpty() && results[0] == PackageManager.PERMISSION_GRANTED
      promise.resolve(if (granted) BackgroundProgress.GRANTED else BackgroundProgress.BLOCKED)
      true
    }
  }

  override fun invalidate() {
    // The queue outlives this module — it is a process-wide singleton so a batch keeps
    // running across a reload — but it must not keep emitting into a torn-down module.
    JobQueue.setEvents(null)
    super.invalidate()
  }
}
