// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import Foundation
import Photos
import PhotosUI
import UIKit
import UniformTypeIdentifiers

/// Pickers, saving, and the filesystem.
///
/// The picker is written by hand rather than taken from a library for one specific
/// reason: `PHPickerViewController` will happily hand back a transcoded JPEG instead of
/// the original HEIC unless it is asked for the file representation of the exact source
/// type. A HEIC-to-JPG converter that receives an already-converted JPEG produces an
/// output identical to its input, and nobody notices until a user does.
///
/// Neither picker needs a runtime permission — both run out of process. Saving to
/// Photos uses add-only authorisation, which cannot read the library.
public enum FileGateway {

    // MARK: - Photo picker

    @MainActor
    public static func pickPhotos(limit: Int, presenter: UIViewController) async throws -> [DetectedFile] {
        var configuration = PHPickerConfiguration(photoLibrary: .shared())
        configuration.selectionLimit = limit
        configuration.preferredAssetRepresentationMode = .current  // never transcode
        configuration.filter = .images
        configuration.selection = .ordered

        let results = await withCheckedContinuation { continuation in
            let picker = PHPickerViewController(configuration: configuration)
            let delegate = PickerDelegate { picked in continuation.resume(returning: picked) }
            picker.delegate = delegate
            objc_setAssociatedObject(picker, &PickerDelegate.associationKey, delegate, .OBJC_ASSOCIATION_RETAIN)
            presenter.present(picker, animated: true)
        }

        return try await withThrowingTaskGroup(of: (Int, DetectedFile).self) { group in
            for (index, result) in results.enumerated() {
                group.addTask {
                    (index, try await materialise(result))
                }
            }
            var collected: [(Int, DetectedFile)] = []
            for try await entry in group { collected.append(entry) }
            // The picker reports selection order; preserve it.
            return collected.sorted { $0.0 < $1.0 }.map(\.1)
        }
    }

    /// Copies the picked item into the app's temporary directory in its original
    /// representation, then detects it from the bytes on disk.
    private static func materialise(_ result: PHPickerResult) async throws -> DetectedFile {
        let provider = result.itemProvider

        // Ask for the most specific type the item actually has, so nothing is converted
        // on the way in.
        let typeIdentifier = provider.registeredTypeIdentifiers.first { identifier in
            UTType(identifier)?.conforms(to: .image) == true
        } ?? UTType.image.identifier

        // Read off the provider before the closure: NSItemProvider is not Sendable, and
        // the name is the only thing needed from it inside.
        let suggestedName = provider.suggestedName

        let url: URL = try await withCheckedThrowingContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { source, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let source else {
                    continuation.resume(throwing: ConversionError.unreadable(suggestedName ?? "file"))
                    return
                }
                // The provided URL is deleted as soon as this closure returns, so the
                // copy has to happen here rather than later.
                do {
                    let name = suggestedName.map { sanitise($0) } ?? UUID().uuidString
                    let ext = source.pathExtension.isEmpty ? "img" : source.pathExtension
                    let destination = temporaryDirectory()
                        .appendingPathComponent("\(name).\(ext)")
                    try? FileManager.default.removeItem(at: destination)
                    try FileManager.default.copyItem(at: source, to: destination)
                    continuation.resume(returning: destination)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }

        return try FormatDetector.detect(url: url)
    }

    private final class PickerDelegate: NSObject, PHPickerViewControllerDelegate {
        nonisolated(unsafe) static var associationKey: UInt8 = 0
        private let completion: ([PHPickerResult]) -> Void
        private var hasCompleted = false

        init(completion: @escaping ([PHPickerResult]) -> Void) {
            self.completion = completion
        }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            picker.dismiss(animated: true)
            // Backing out of the picker delivers an empty array, which is not an error.
            guard !hasCompleted else { return }
            hasCompleted = true
            completion(results)
        }
    }

    // MARK: - Saving

    /// Writes finished images to the photo library using add-only authorisation, the
    /// least privileged option available. It cannot read the library.
    public static func saveToPhotos(urls: [URL]) async throws {
        let status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
        let granted: PHAuthorizationStatus = status == .notDetermined
            ? await PHPhotoLibrary.requestAuthorization(for: .addOnly)
            : status

        guard granted == .authorized || granted == .limited else {
            throw ConversionError.permissionDenied
        }

        try await PHPhotoLibrary.shared().performChanges {
            for url in urls {
                PHAssetCreationRequest.creationRequestForAssetFromImage(atFileURL: url)
            }
        }
    }

    // MARK: - Filesystem

    public static func temporaryDirectory() -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ConverterWork", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    public static func clearTemporaryFiles() throws {
        try? FileManager.default.removeItem(at: temporaryDirectory())
        _ = temporaryDirectory()
    }

    public static func freeDiskSpace() -> Int64 {
        let values = try? URL(fileURLWithPath: NSHomeDirectory())
            .resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return values?.volumeAvailableCapacityForImportantUsage ?? 0
    }

    /// Makes a name safe for the filesystem without mangling it.
    ///
    /// Emoji and right-to-left text survive intact — they are perfectly legal in a
    /// filename and stripping them is the kind of "sanitising" that makes a user's file
    /// unrecognisable. Only the genuinely reserved characters are replaced, and the
    /// length cap counts UTF-8 bytes against the 255-byte limit while trimming on a
    /// character boundary so a multi-byte character is never cut in half.
    public static func sanitise(_ name: String) -> String {
        let reserved = CharacterSet(charactersIn: "/\\:*?\"<>|\0")
        var cleaned = name
            .components(separatedBy: reserved)
            .joined(separator: "_")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        // A leading dot hides the file on every Unix filesystem.
        while cleaned.hasPrefix(".") { cleaned.removeFirst() }
        if cleaned.isEmpty { cleaned = "file" }

        // Leave headroom for an extension and a " (12)" collision suffix.
        let maxBytes = 200
        while cleaned.utf8.count > maxBytes, !cleaned.isEmpty {
            cleaned.removeLast()
        }
        return cleaned
    }

    /// Appends " (1)", " (2)" until the name is free. Never overwrites.
    public static func resolveCollision(directory: URL, filename: String) -> URL {
        let base = (filename as NSString).deletingPathExtension
        let ext = (filename as NSString).pathExtension

        var candidate = directory.appendingPathComponent(filename)
        var suffix = 1
        while FileManager.default.fileExists(atPath: candidate.path) {
            let next = ext.isEmpty ? "\(base) (\(suffix))" : "\(base) (\(suffix)).\(ext)"
            candidate = directory.appendingPathComponent(next)
            suffix += 1
        }
        return candidate
    }
}
