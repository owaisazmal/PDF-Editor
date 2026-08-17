// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import Foundation
import UIKit
import UniformTypeIdentifiers

/// Documents, cloud files and archiving.
///
/// All three use system facilities rather than a dependency: the document picker for
/// Files, `startDownloadingUbiquitousItem` for iCloud, and `NSFileCoordinator`'s
/// `.forUploading` option — which produces a zip archive of a directory — instead of a
/// third-party archiver. That keeps the dependency tree smaller and the licence gate
/// quieter, and it is less code.
extension FileGateway {

    // MARK: - Document picker

    @MainActor
    public static func pickDocuments(
        contentTypes: [UTType],
        allowMultiple: Bool,
        presenter: UIViewController
    ) async throws -> [DetectedFile] {
        let picked: [URL] = await withCheckedContinuation { continuation in
            let picker = UIDocumentPickerViewController(
                forOpeningContentTypes: contentTypes.isEmpty ? [.item] : contentTypes,
                asCopy: true  // the copy lands in our container, so no bookmark is needed
            )
            picker.allowsMultipleSelection = allowMultiple

            let delegate = DocumentPickerDelegate { urls in continuation.resume(returning: urls) }
            picker.delegate = delegate
            objc_setAssociatedObject(picker, &DocumentPickerDelegate.associationKey, delegate, .OBJC_ASSOCIATION_RETAIN)
            presenter.present(picker, animated: true)
        }

        return try picked.map { url in
            // A file still in iCloud has a placeholder on disk; materialise it before
            // detection, or the header read sees nothing.
            let local = try ensureLocalSync(url)
            return try FormatDetector.detect(url: local)
        }
    }

    private final class DocumentPickerDelegate: NSObject, UIDocumentPickerDelegate {
        nonisolated(unsafe) static var associationKey: UInt8 = 0
        private let completion: ([URL]) -> Void
        private var hasCompleted = false

        init(completion: @escaping ([URL]) -> Void) { self.completion = completion }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            finish(urls)
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            finish([])
        }

        private func finish(_ urls: [URL]) {
            guard !hasCompleted else { return }
            hasCompleted = true
            completion(urls)
        }
    }

    // MARK: - Cloud files

    /// Triggers a download for a file that lives in iCloud and waits for it.
    ///
    /// A file the user can see in Files is not necessarily on the device. Failing with
    /// "could not read" in that case is the wrong answer — the right one is to fetch it.
    public static func ensureLocalSync(_ url: URL, timeout: TimeInterval = 60) throws -> URL {
        let values = try? url.resourceValues(forKeys: [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey])

        guard values?.isUbiquitousItem == true else { return url }
        if values?.ubiquitousItemDownloadingStatus == .current { return url }

        try FileManager.default.startDownloadingUbiquitousItem(at: url)

        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let status = try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey])
                .ubiquitousItemDownloadingStatus
            if status == .current { return url }
            Thread.sleep(forTimeInterval: 0.2)
        }
        throw ConversionError.downloadFailed(url.lastPathComponent)
    }

    // MARK: - Exporting

    /// Hands files to the Files app through the export picker. On iOS there is no
    /// writable Downloads directory, so the user chooses the destination.
    @MainActor
    public static func saveToDownloads(urls: [URL], presenter: UIViewController) async throws -> [String] {
        guard !urls.isEmpty else { return [] }

        return await withCheckedContinuation { continuation in
            let picker = UIDocumentPickerViewController(forExporting: urls, asCopy: true)
            let delegate = DocumentPickerDelegate { saved in
                continuation.resume(returning: saved.map(\.absoluteString))
            }
            picker.delegate = delegate
            objc_setAssociatedObject(picker, &DocumentPickerDelegate.associationKey, delegate, .OBJC_ASSOCIATION_RETAIN)
            presenter.present(picker, animated: true)
        }
    }

    // MARK: - Archiving

    /// Bundles files into a zip using `NSFileCoordinator`'s `.forUploading` option,
    /// which is the system's own archiver. No third-party dependency, no licence to
    /// audit, and it streams rather than holding the archive in memory.
    public static func createZip(urls: [URL], zipName: String) throws -> URL {
        let staging = temporaryDirectory()
            .appendingPathComponent("zip-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: staging) }

        for url in urls {
            let destination = resolveCollision(directory: staging, filename: url.lastPathComponent)
            try FileManager.default.copyItem(at: url, to: destination)
        }

        let safeName = sanitise(zipName.isEmpty ? "Converted" : zipName)
        let output = resolveCollision(
            directory: try RasterCodec.managedOutputDirectory(),
            filename: "\(safeName).zip"
        )

        var coordinatorError: NSError?
        var thrownError: Error?

        NSFileCoordinator().coordinate(
            readingItemAt: staging,
            options: [.forUploading],
            error: &coordinatorError
        ) { archiveURL in
            do {
                try? FileManager.default.removeItem(at: output)
                try FileManager.default.moveItem(at: archiveURL, to: output)
            } catch {
                thrownError = error
            }
        }

        if let coordinatorError { throw coordinatorError }
        if let thrownError { throw thrownError }
        return output
    }
}
