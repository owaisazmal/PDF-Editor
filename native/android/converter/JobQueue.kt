// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.core

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * The batch executor. This is the spine of the app.
 *
 * JavaScript submits one declarative job and then only observes. It never loops over
 * files, holds a buffer, or schedules work — which is what makes cancellation able to
 * abort work already in flight, lets the batch survive the app going to the background,
 * and keeps the memory ceiling enforced where the allocations happen.
 *
 * Progress is coalesced before it crosses the bridge. Emitting an event per file at full
 * speed for a 500-file batch floods the JS thread, and a progress bar that cannot keep
 * up looks slower than one that updates ten times a second.
 *
 * Mirrors `JobQueue.swift`.
 */
public object JobQueue {

  /** Roughly 10 Hz. Fast enough to look continuous, slow enough to stay cheap. */
  private const val PROGRESS_INTERVAL_MS = 100L

  public interface Events {
    public fun onProgress(payload: WritableMap)
    public fun onFileComplete(payload: WritableMap)
    public fun onFileFailed(payload: WritableMap)
    public fun onJobComplete(payload: WritableMap)
  }

  @Volatile
  private var events: Events? = null

  private val jobs = ConcurrentHashMap<String, Job>()

  /** Set once by the TurboModule. The share target leaves it null; nothing listens there. */
  @JvmStatic
  public fun setEvents(events: Events?) {
    this.events = events
  }

  // ------------------------------------------------------------------ submitting --

  /** Queues a job and returns immediately. Every observable outcome arrives as an event. */
  @JvmStatic
  public fun submit(spec: JobSpec) {
    val job = Job(spec) { emit -> events?.let(emit) }
    jobs[spec.jobId] = job
    job.start()
  }

  @JvmStatic
  public fun cancel(jobId: String, onDrained: () -> Unit) {
    val job = jobs[jobId]
    if (job == null) {
      onDrained()
      return
    }
    job.cancel(onDrained)
  }

  /** Re-runs only the files that failed, keeping the original settings. */
  @JvmStatic
  public fun retryFailed(jobId: String) {
    jobs[jobId]?.retryFailed()
  }

  /**
   * The authoritative state. JavaScript mirrors this, but native owns it: after a
   * stretch in the background the mirror is stale and is replaced from here.
   */
  @JvmStatic
  public fun state(jobId: String): WritableMap =
    jobs[jobId]?.snapshot() ?: Arguments.createMap().apply {
      putString("jobId", jobId)
      putString("status", "failed")
      putMap("progress", emptyProgress(jobId))
      putArray("results", Arguments.createArray())
      putArray("failures", Arguments.createArray())
    }

  /** Drops a finished job's bookkeeping. Does not touch output files. */
  @JvmStatic
  public fun release(jobId: String) {
    jobs.remove(jobId)?.shutdown()
  }

  private fun emptyProgress(jobId: String): WritableMap = Arguments.createMap().apply {
    putString("jobId", jobId)
    putInt("completedCount", 0)
    putInt("failedCount", 0)
    putInt("totalCount", 0)
    putDouble("fraction", 0.0)
    putString("currentDisplayName", "")
  }

  // ------------------------------------------------------------------------ job --

  /** A failed file, with enough context to retry it in its original position. */
  private data class Failure(val index: Int, val input: JobSpec.Input, val payload: WritableMap)

  private class Job(
    private val spec: JobSpec,
    private val withEvents: ((Events) -> Unit) -> Unit,
  ) {
    private val executor: ThreadPoolExecutor =
      Executors.newFixedThreadPool(spec.resolvedConcurrency) as ThreadPoolExecutor

    private val cancelling = AtomicBoolean(false)
    private val completedBytes = AtomicLong(0)
    private val lastEmit = AtomicLong(0)

    /**
     * Progress is weighted by input byte size, not file count. A batch of one 80-megapixel
     * RAW and forty thumbnails is not 2.5% done after the first file.
     */
    private val totalBytes: Long = spec.inputs.sumOf { it.byteSize }

    private val lock = Any()
    private var status: String = "queued"
    private val results = mutableListOf<WritableMap>()
    private val failures = mutableListOf<Failure>()
    private var currentDisplayName: String = ""
    private var remaining: CountDownLatch? = null

    fun start() {
      synchronized(lock) { status = "running" }
      enqueue(spec.inputs.mapIndexed { index, input -> index to input })
    }

    /**
     * Takes `(sourceIndex, input)` pairs rather than a bare list: the index is the
     * file's position in what the user picked, and it has to survive a retry.
     * Re-enumerating on retry would renumber the retried files into positions belonging
     * to files that already succeeded.
     */
    private fun enqueue(items: List<Pair<Int, JobSpec.Input>>) {
      val latch = CountDownLatch(items.size)
      synchronized(lock) { remaining = latch }

      items.forEach { (index, input) ->
        executor.execute {
          try {
            process(input, index)
          } finally {
            latch.countDown()
          }
        }
      }

      // A watcher rather than a barrier task, so cancellation does not have to race it.
      Thread {
        latch.await()
        finish()
      }.apply { isDaemon = true }.start()
    }

    private fun process(input: JobSpec.Input, index: Int) {
      if (cancelling.get()) return

      synchronized(lock) { currentDisplayName = input.displayName }

      try {
        val result = RasterCodec.convert(
          input = input.file,
          requestedOutput = spec.outputFileFor(input, index),
          outputDirectory = spec.outputDirectory,
          options = spec.options,
        )
        if (cancelling.get()) {
          // Cancelled between encoding and reporting: the file on disk is complete but
          // unwanted, so it does not survive.
          result.outputFile.delete()
          return
        }
        // The file's position in the user's selection, so the UI can present results in
        // the order they picked rather than the order a concurrent queue finished them.
        record(result.toWritableMap().apply { putInt("sourceIndex", index) }, input.byteSize)
      } catch (error: Throwable) {
        // One corrupt file must never end the batch.
        val failure = JobSpec.failurePayload(input, error).apply { putInt("sourceIndex", index) }
        record(index, input, failure, input.byteSize)
      }
    }

    private fun record(result: WritableMap, bytes: Long) {
      synchronized(lock) { results.add(result) }
      completedBytes.addAndGet(bytes)

      withEvents { it.onFileComplete(Arguments.createMap().apply {
        putString("jobId", spec.jobId)
        putMap("result", result.copy())
      }) }
      emitProgressIfDue()
    }

    private fun record(index: Int, input: JobSpec.Input, failure: WritableMap, bytes: Long) {
      synchronized(lock) { failures.add(Failure(index, input, failure)) }
      completedBytes.addAndGet(bytes)

      withEvents { it.onFileFailed(Arguments.createMap().apply {
        putString("jobId", spec.jobId)
        putMap("failure", failure.copy())
      }) }
      emitProgressIfDue()
    }

    /** Throttled to PROGRESS_INTERVAL_MS; the final state is always emitted by finish(). */
    private fun emitProgressIfDue() {
      val now = System.currentTimeMillis()
      val previous = lastEmit.get()
      if (now - previous < PROGRESS_INTERVAL_MS) return
      if (!lastEmit.compareAndSet(previous, now)) return

      withEvents { it.onProgress(progressPayload()) }
    }

    private fun finish() {
      synchronized(lock) {
        // A job with failures is still completed: continue-on-error means the batch
        // finished, and the per-file failures are the result, not an exception to it.
        status = if (cancelling.get()) "cancelled" else "completed"
      }
      withEvents { it.onProgress(progressPayload()) }
      withEvents { it.onJobComplete(snapshot()) }
    }

    fun cancel(onDrained: () -> Unit) {
      cancelling.set(true)
      synchronized(lock) { status = "cancelling" }

      // Draining off the caller's thread keeps a cancel tap responsive even when several
      // large files are mid-encode.
      Thread {
        executor.shutdownNow()
        executor.awaitTermination(30, TimeUnit.SECONDS)
        synchronized(lock) { status = "cancelled" }
        onDrained()
      }.apply { isDaemon = true }.start()
    }

    fun retryFailed() {
      val retryable: List<Pair<Int, JobSpec.Input>>
      synchronized(lock) {
        // Keyed by the original index so a retried file keeps the position it was
        // picked in.
        retryable = failures.map { it.index to it.input }
        completedBytes.addAndGet(-retryable.sumOf { it.second.byteSize })
        failures.clear()
        status = "running"
      }
      if (retryable.isEmpty()) {
        finish()
        return
      }
      enqueue(retryable)
    }

    fun shutdown() {
      executor.shutdownNow()
    }

    // Snapshots ---------------------------------------------------------------

    fun snapshot(): WritableMap = synchronized(lock) {
      Arguments.createMap().apply {
        putString("jobId", spec.jobId)
        putString("status", status)
        putMap("progress", progressPayload())
        putArray("results", Arguments.createArray().apply { results.forEach { pushMap(it.copy()) } })
        putArray("failures", Arguments.createArray().apply { failures.forEach { pushMap(it.payload.copy()) } })
      }
    }

    private fun progressPayload(): WritableMap = synchronized(lock) {
      val total = spec.inputs.size
      val done = results.size + failures.size
      val fraction = when {
        totalBytes > 0 -> minOf(1.0, completedBytes.get().toDouble() / totalBytes.toDouble())
        total > 0 -> done.toDouble() / total.toDouble()
        else -> 0.0
      }

      Arguments.createMap().apply {
        putString("jobId", spec.jobId)
        putInt("completedCount", results.size)
        putInt("failedCount", failures.size)
        putInt("totalCount", total)
        putDouble("fraction", fraction)
        putString("currentDisplayName", currentDisplayName)
      }
    }
  }
}

/**
 * A WritableMap may only cross the bridge once, so anything retained for a later
 * snapshot has to be copied rather than re-sent.
 */
private fun WritableMap.copy(): WritableMap = Arguments.createMap().apply { merge(this@copy) }
