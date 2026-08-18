// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import Foundation
import UIKit

/// The batch executor. This is the spine of the app.
///
/// JavaScript submits one declarative job and then only observes. It never loops over
/// files, holds a buffer, or schedules work. Four things depend on that:
///
///   - **Backgrounding.** iOS suspends the JavaScript runtime, so a JS-driven loop
///     stalls mid-batch. This queue keeps running under `beginBackgroundTask`.
///   - **The share extension.** It links this class directly and runs no JavaScript.
///   - **Cancellation that cancels.** Only the owner of the operations can abort work
///     already in flight, and only it can clean up the partial file that work left.
///   - **A memory ceiling.** Concurrency is sized from the CPU count *and* the device's
///     RAM class, because each in-flight conversion can hold a full-resolution bitmap.
///
/// Progress is coalesced before it crosses the bridge. Emitting an event per file at
/// full speed for a 500-file batch floods the JS thread, and a progress bar that cannot
/// keep up looks slower than one that updates ten times a second.
public final class JobQueue: @unchecked Sendable {

    public static let shared = JobQueue()

    /// Roughly 10 Hz. Fast enough to look continuous, slow enough to stay cheap.
    private static let progressInterval: TimeInterval = 0.1

    public struct Events {
        public var onProgress: ([String: Any]) -> Void
        public var onFileComplete: ([String: Any]) -> Void
        public var onFileFailed: ([String: Any]) -> Void
        public var onJobComplete: ([String: Any]) -> Void

        public init(
            onProgress: @escaping ([String: Any]) -> Void = { _ in },
            onFileComplete: @escaping ([String: Any]) -> Void = { _ in },
            onFileFailed: @escaping ([String: Any]) -> Void = { _ in },
            onJobComplete: @escaping ([String: Any]) -> Void = { _ in }
        ) {
            self.onProgress = onProgress
            self.onFileComplete = onFileComplete
            self.onFileFailed = onFileFailed
            self.onJobComplete = onJobComplete
        }
    }

    private var events = Events()
    private var jobs: [String: Job] = [:]
    private let lock = NSLock()

    private init() {}

    /// Set once by the TurboModule. The share extension leaves it at the default,
    /// because nothing is listening there.
    public func setEvents(_ events: Events) {
        lock.lock()
        defer { lock.unlock() }
        self.events = events
    }

    // MARK: - Submitting

    /// Queues a job and returns immediately. Every observable outcome arrives as an event.
    public func submit(_ spec: JobSpec) {
        let job = Job(spec: spec)

        lock.lock()
        jobs[spec.jobId] = job
        lock.unlock()

        job.begin(
            concurrency: spec.resolvedConcurrency,
            continueInBackground: spec.continueInBackground
        ) { [weak self] event in
            self?.dispatch(event)
        }
    }

    public func cancel(jobId: String, completion: @escaping () -> Void) {
        lock.lock()
        let job = jobs[jobId]
        lock.unlock()

        guard let job else {
            completion()
            return
        }
        job.cancel(completion: completion)
    }

    /// Re-runs only the files that failed, keeping the original settings.
    public func retryFailed(jobId: String) {
        lock.lock()
        let job = jobs[jobId]
        lock.unlock()
        job?.retryFailed { [weak self] event in self?.dispatch(event) }
    }

    /// The authoritative state. JavaScript mirrors this, but native owns it: after a
    /// stretch in the background the mirror is stale and is replaced from here.
    public func state(jobId: String) -> [String: Any] {
        lock.lock()
        let job = jobs[jobId]
        lock.unlock()
        return job?.snapshot() ?? [
            "jobId": jobId,
            "status": "failed",
            "progress": Job.emptyProgress(jobId: jobId),
            "results": [],
            "failures": [],
        ]
    }

    /// Drops a finished job's bookkeeping. Does not touch output files.
    public func release(jobId: String) {
        lock.lock()
        jobs.removeValue(forKey: jobId)
        lock.unlock()
    }

    // MARK: - Event dispatch

    private enum Event {
        case progress([String: Any])
        case fileComplete([String: Any])
        case fileFailed([String: Any])
        case jobComplete([String: Any])
    }

    private func dispatch(_ event: Event) {
        lock.lock()
        let events = self.events
        lock.unlock()

        switch event {
        case .progress(let payload): events.onProgress(payload)
        case .fileComplete(let payload): events.onFileComplete(payload)
        case .fileFailed(let payload): events.onFileFailed(payload)
        case .jobComplete(let payload): events.onJobComplete(payload)
        }
    }

    // MARK: - Job

    private final class Job: @unchecked Sendable {
        private let spec: JobSpec
        private let queue = OperationQueue()
        private let lock = NSLock()

        private var status: String = "queued"
        private var results: [[String: Any]] = []
        private var failures: [[String: Any]] = []
        private var completedBytes: Int64 = 0
        private var currentDisplayName: String = ""
        private var lastEmit: Date = .distantPast
        private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

        /// Progress is weighted by input byte size, not file count. A batch of one
        /// 80-megapixel RAW and forty thumbnails is not 2.5% done after the first file.
        private let totalBytes: Int64

        init(spec: JobSpec) {
            self.spec = spec
            self.totalBytes = spec.inputs.reduce(0) { $0 + $1.byteSize }
            queue.qualityOfService = .userInitiated
        }

        func begin(
            concurrency: Int,
            continueInBackground: Bool,
            emit: @escaping (Event) -> Void
        ) {
            queue.maxConcurrentOperationCount = concurrency

            if continueInBackground {
                // Without this the OS suspends the process at the next opportunity and
                // a long batch simply stops, which users read as the app losing their work.
                backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "converter.job") { [weak self] in
                    self?.cancel(completion: {})
                }
            }

            lock.lock()
            status = "running"
            lock.unlock()

            enqueue(spec.inputs, emit: emit)
        }

        private func enqueue(_ inputs: [JobSpec.Input], emit: @escaping (Event) -> Void) {
            for (index, input) in inputs.enumerated() {
                queue.addOperation { [weak self] in
                    self?.process(input: input, index: index, emit: emit)
                }
            }

            // A barrier that runs once every file has been attempted.
            queue.addBarrierBlock { [weak self] in
                self?.finish(emit: emit)
            }
        }

        private func process(input: JobSpec.Input, index: Int, emit: @escaping (Event) -> Void) {
            if isCancelling { return }

            lock.lock()
            currentDisplayName = input.url.lastPathComponent
            lock.unlock()

            // One autorelease pool per file is what keeps peak memory flat across a
            // batch rather than growing until the OS intervenes.
            autoreleasepool {
                do {
                    let output = spec.outputURL(for: input, index: index)
                    let result = try RasterCodec.convert(
                        inputURL: input.url,
                        outputURL: output,
                        options: spec.options
                    )
                    guard !isCancelling else {
                        // Cancelled between encoding and reporting: the file on disk is
                        // complete but unwanted, so it does not survive.
                        try? FileManager.default.removeItem(at: result.outputURL)
                        return
                    }
                    record(result: result.dictionaryRepresentation, bytes: input.byteSize, emit: emit)
                } catch {
                    record(
                        failure: JobSpec.failurePayload(for: input, error: error),
                        bytes: input.byteSize,
                        emit: emit
                    )
                }
            }
        }

        private var isCancelling: Bool {
            lock.lock()
            defer { lock.unlock() }
            return status == "cancelling" || status == "cancelled"
        }

        private func record(result: [String: Any], bytes: Int64, emit: @escaping (Event) -> Void) {
            lock.lock()
            results.append(result)
            completedBytes += bytes
            lock.unlock()

            emit(.fileComplete(["jobId": spec.jobId, "result": result]))
            emitProgressIfDue(emit: emit)
        }

        private func record(failure: [String: Any], bytes: Int64, emit: @escaping (Event) -> Void) {
            lock.lock()
            failures.append(failure)
            completedBytes += bytes
            lock.unlock()

            // One corrupt file must never end the batch.
            emit(.fileFailed(["jobId": spec.jobId, "failure": failure]))
            emitProgressIfDue(emit: emit)
        }

        /// Throttled to `progressInterval`; the final state is always emitted by `finish`.
        private func emitProgressIfDue(emit: @escaping (Event) -> Void) {
            lock.lock()
            let due = Date().timeIntervalSince(lastEmit) >= JobQueue.progressInterval
            if due { lastEmit = Date() }
            let payload = progressPayload()
            lock.unlock()

            if due { emit(.progress(payload)) }
        }

        private func finish(emit: @escaping (Event) -> Void) {
            lock.lock()
            // A job with failures is still completed: continue-on-error means the
            // batch finished, and the per-file failures are the result, not an
            // exception to it.
            status = (status == "cancelling" || status == "cancelled") ? "cancelled" : "completed"
            let payload = progressPayload()
            let snapshot = snapshotLocked()
            lock.unlock()

            emit(.progress(payload))
            emit(.jobComplete(snapshot))
            endBackgroundTask()
        }

        func cancel(completion: @escaping () -> Void) {
            lock.lock()
            status = "cancelling"
            lock.unlock()

            queue.cancelAllOperations()

            // Draining off the caller's thread keeps a cancel tap responsive even when
            // several large files are mid-encode.
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                self?.queue.waitUntilAllOperationsAreFinished()
                self?.lock.lock()
                self?.status = "cancelled"
                self?.lock.unlock()
                self?.endBackgroundTask()
                completion()
            }
        }

        func retryFailed(emit: @escaping (Event) -> Void) {
            lock.lock()
            let retryable = failures.compactMap { failure -> JobSpec.Input? in
                guard let uri = failure["uri"] as? String else { return nil }
                return spec.inputs.first { $0.url.absoluteString == uri }
            }
            failures.removeAll()
            completedBytes = max(0, completedBytes - retryable.reduce(0) { $0 + $1.byteSize })
            status = "running"
            lock.unlock()

            guard !retryable.isEmpty else {
                finish(emit: emit)
                return
            }
            enqueue(retryable, emit: emit)
        }

        private func endBackgroundTask() {
            guard backgroundTask != .invalid else { return }
            UIApplication.shared.endBackgroundTask(backgroundTask)
            backgroundTask = .invalid
        }

        // MARK: Snapshots

        func snapshot() -> [String: Any] {
            lock.lock()
            defer { lock.unlock() }
            return snapshotLocked()
        }

        private func snapshotLocked() -> [String: Any] {
            [
                "jobId": spec.jobId,
                "status": status,
                "progress": progressPayload(),
                "results": results,
                "failures": failures,
            ]
        }

        private func progressPayload() -> [String: Any] {
            let total = spec.inputs.count
            let done = results.count + failures.count
            let fraction: Double = totalBytes > 0
                ? min(1, Double(completedBytes) / Double(totalBytes))
                : (total > 0 ? Double(done) / Double(total) : 0)

            return [
                "jobId": spec.jobId,
                "completedCount": results.count,
                "failedCount": failures.count,
                "totalCount": total,
                "fraction": fraction,
                "currentDisplayName": currentDisplayName,
            ]
        }

        static func emptyProgress(jobId: String) -> [String: Any] {
            [
                "jobId": jobId,
                "completedCount": 0,
                "failedCount": 0,
                "totalCount": 0,
                "fraction": 0,
                "currentDisplayName": "",
            ]
        }
    }
}
