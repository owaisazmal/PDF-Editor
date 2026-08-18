// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import Foundation

/// A batch of work, described declaratively.
///
/// Everything the queue needs is decided here, before any file is touched: how many
/// conversions may run at once, where each output goes, and what it is called. Deciding
/// it up front is what lets the queue be a dumb executor, and a dumb executor is one
/// that can be reasoned about while it is running in the background.
public struct JobSpec: Sendable {

    public struct Input: Sendable {
        public let url: URL
        public let byteSize: Int64
        public let displayName: String
    }

    public let jobId: String
    public let inputs: [Input]
    public let options: RasterCodec.Options
    public let outputDirectory: URL
    /// `{name}`, `{index}`, `{date}`, `{format}`. Empty keeps the source name.
    public let namePattern: String
    /// 0 means "decide from the hardware".
    public let requestedConcurrency: Int
    public let continueInBackground: Bool

    // MARK: - Parsing

    public init?(dictionary: [String: Any]) {
        guard let jobId = dictionary["jobId"] as? String, !jobId.isEmpty else { return nil }
        let uris = dictionary["inputUris"] as? [String] ?? []

        self.jobId = jobId
        self.inputs = uris.map { uri in
            let url = JobSpec.fileURL(from: uri)
            let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)??.int64Value
            return Input(url: url, byteSize: size ?? 0, displayName: url.lastPathComponent)
        }
        self.options = RasterCodec.Options(dictionary: dictionary["options"] as? [String: Any] ?? [:])
        self.namePattern = dictionary["namePattern"] as? String ?? ""
        self.requestedConcurrency = dictionary["maxConcurrency"] as? Int ?? 0
        self.continueInBackground = dictionary["continueInBackground"] as? Bool ?? true

        let directory = dictionary["outputDirectory"] as? String ?? ""
        self.outputDirectory = directory.isEmpty
            ? ((try? RasterCodec.managedOutputDirectory()) ?? FileManager.default.temporaryDirectory)
            : JobSpec.fileURL(from: directory)
    }

    private static func fileURL(from uri: String) -> URL {
        if uri.hasPrefix("file://"), let url = URL(string: uri) { return url }
        return URL(fileURLWithPath: uri)
    }

    // MARK: - Concurrency

    /// Sized from the CPU count *and* the device's memory.
    ///
    /// Cores alone is the wrong answer: each in-flight conversion can hold a
    /// full-resolution bitmap, so on a 3&nbsp;GB phone running six at once is how a
    /// 300-image batch gets killed by the OS two thirds of the way through. The cap of
    /// six exists because past that the disk, not the CPU, is the limit.
    public var resolvedConcurrency: Int {
        if requestedConcurrency > 0 { return requestedConcurrency }

        let cores = ProcessInfo.processInfo.activeProcessorCount
        let gigabytes = Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824
        // Budget roughly 1.5 GB of headroom per concurrent conversion.
        let byMemory = Int(gigabytes / 1.5)

        return max(1, min(cores, max(1, byMemory), 6))
    }

    // MARK: - Output naming

    /// Where one input's output goes, with collisions resolved rather than overwritten.
    public func outputURL(for input: Input, index: Int) -> URL {
        let ext = FormatTable.spec(options.targetFormat)?.extensions.first ?? options.targetFormat
        let base = expandedName(for: input, index: index)
        return FileGateway.resolveCollision(
            directory: outputDirectory,
            filename: "\(FileGateway.sanitise(base)).\(ext)"
        )
    }

    private func expandedName(for input: Input, index: Int) -> String {
        let sourceName = (input.displayName as NSString).deletingPathExtension
        guard !namePattern.isEmpty else { return sourceName }

        // `index` is one-based because it appears in filenames people read.
        return namePattern
            .replacingOccurrences(of: "{name}", with: sourceName)
            .replacingOccurrences(of: "{index}", with: String(format: "%03d", index + 1))
            .replacingOccurrences(of: "{date}", with: JobSpec.dateStamp())
            .replacingOccurrences(of: "{format}", with: options.targetFormat)
    }

    private static func dateStamp() -> String {
        let formatter = DateFormatter()
        // Fixed locale and format: a filename is not a place for locale-dependent
        // ordering, and this sorts correctly as text.
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    // MARK: - Failures

    /// One file's failure, in the shape JavaScript expects.
    public static func failurePayload(for input: Input, error: Error) -> [String: Any] {
        let conversionError = error as? ConversionError
        return [
            "uri": input.url.absoluteString,
            "displayName": input.displayName,
            "code": conversionError?.code ?? "unknown",
            "message": conversionError?.errorDescription ?? error.localizedDescription,
        ]
    }
}
