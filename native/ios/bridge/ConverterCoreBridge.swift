// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import Foundation
import UIKit
import UniformTypeIdentifiers

/// The Objective-C facing surface of ConverterCore.
///
/// ConverterCore itself is written in idiomatic Swift — enums, structs, `throws`,
/// `async` — none of which Objective-C can see. This class is the only place those get
/// flattened into blocks and dictionaries, so the TurboModule shim in
/// `ConverterCoreModules.mm` stays a thin forwarding layer with no logic to get wrong.
///
/// Every entry point that touches pixels hops to a background queue first. The JS
/// thread is never the place decoding happens, and neither is the main thread.
@objc(ConverterCoreBridge)
public final class ConverterCoreBridge: NSObject {

    /// Serial for ordering, concurrent underneath via `DispatchQueue.concurrentPerform`
    /// where a batch warrants it. Phase 1 is single-file, so a utility queue is enough.
    private static let workQueue = DispatchQueue(
        label: "com.owaiskhan.converter.core",
        qos: .userInitiated,
        attributes: .concurrent
    )

    /// Bridges a throwing Swift call into a promise, mapping our error codes across so
    /// JavaScript can show a translated message rather than an English string.
    private static func run(
        resolve: @escaping (Any?) -> Void,
        reject: @escaping (String?, String?, Error?) -> Void,
        work: @escaping () throws -> Any?
    ) {
        workQueue.async {
            do {
                let value = try work()
                resolve(value)
            } catch let error as ConversionError {
                reject(error.code, error.errorDescription ?? error.code, error)
            } catch {
                reject("unknown", error.localizedDescription, error)
            }
        }
    }

    // MARK: - NativeFormatDetector

    @objc(detect:resolve:reject:)
    public static func detect(
        _ uri: String,
        resolve: @escaping (Any?) -> Void,
        reject: @escaping (String?, String?, Error?) -> Void
    ) {
        run(resolve: resolve, reject: reject) {
            try FormatDetector.detect(url: fileURL(from: uri)).dictionaryRepresentation
        }
    }

    @objc(detectMany:resolve:reject:)
    public static func detectMany(
        _ uris: [String],
        resolve: @escaping (Any?) -> Void,
        reject: @escaping (String?, String?, Error?) -> Void
    ) {
        run(resolve: resolve, reject: reject) {
            // Detection is header-only and cheap, but a 500-file selection still
            // benefits from the cores. Order is preserved for the caller.
            var results = [[String: Any]?](repeating: nil, count: uris.count)
            let lock = NSLock()

            DispatchQueue.concurrentPerform(iterations: uris.count) { index in
                let detected = try? FormatDetector.detect(url: fileURL(from: uris[index]))
                lock.lock()
                results[index] = detected?.dictionaryRepresentation
                lock.unlock()
            }

            // A file that could not be opened at all still gets an entry, so the caller
            // can report it rather than silently receiving a shorter list.
            return results.enumerated().map { index, value in
                value ?? unreadablePlaceholder(uri: uris[index])
            }
        }
    }

    @objc(detectBase64:filename:resolve:reject:)
    public static func detectBase64(
        _ base64: String,
        filename: String,
        resolve: @escaping (Any?) -> Void,
        reject: @escaping (String?, String?, Error?) -> Void
    ) {
        run(resolve: resolve, reject: reject) {
            guard let data = Data(base64Encoded: base64) else {
                throw ConversionError.corrupt(filename)
            }
            return FormatDetector.detect(data: data, filename: filename).dictionaryRepresentation
        }
    }

    @objc(supportedFormats:reject:)
    public static func supportedFormats(
        _ resolve: @escaping (Any?) -> Void,
        reject: @escaping (String?, String?, Error?) -> Void
    ) {
        run(resolve: resolve, reject: reject) {
            Capabilities.current().dictionaryRepresentation
        }
    }

    // MARK: - NativeRasterCodec

    @objc(convert:outputUri:options:resolve:reject:)
    public static func convert(
        _ inputUri: String,
        outputUri: String,
        options: [String: Any],
        resolve: @escaping (Any?) -> Void,
        reject: @escaping (String?, String?, Error?) -> Void
    ) {
        run(resolve: resolve, reject: reject) {
            try RasterCodec.convert(
                inputURL: fileURL(from: inputUri),
                outputURL: outputUri.isEmpty ? nil : fileURL(from: outputUri),
                options: RasterCodec.Options(dictionary: options)
            ).dictionaryRepresentation
        }
    }

    @objc(estimateByteSize:options:resolve:reject:)
    public static func estimateByteSize(
        _ inputUri: String,
        options: [String: Any],
        resolve: @escaping (Any?) -> Void,
        reject: @escaping (String?, String?, Error?) -> Void
    ) {
        run(resolve: resolve, reject: reject) {
            let scratch = FileGateway.temporaryDirectory()
                .appendingPathComponent("estimate-\(UUID().uuidString)")
            defer { try? FileManager.default.removeItem(at: scratch) }

            let result = try RasterCodec.convert(
                inputURL: fileURL(from: inputUri),
                outputURL: scratch,
                options: RasterCodec.Options(dictionary: options)
            )
            return Double(result.byteSize)
        }
    }

    @objc(makePreview:maxPixelSize:resolve:reject:)
    public static func makePreview(
        _ inputUri: String,
        maxPixelSize: Double,
        resolve: @escaping (Any?) -> Void,
        reject: @escaping (String?, String?, Error?) -> Void
    ) {
        run(resolve: resolve, reject: reject) {
            var options = RasterCodec.Options()
            options.targetFormat = "jpeg"
            options.quality = 80
            options.resizeMode = "maxDimension"
            options.maxWidth = Int(maxPixelSize)
            options.maxHeight = Int(maxPixelSize)
            options.metadataMode = "stripAll"

            let destination = FileGateway.temporaryDirectory()
                .appendingPathComponent("preview-\(UUID().uuidString).jpg")
            let result = try RasterCodec.convert(
                inputURL: fileURL(from: inputUri),
                outputURL: destination,
                options: options
            )
            return result.outputURL.absoluteString
        }
    }

    /// Phase 1 converts one file at a time, so there is nothing in flight to abort.
    /// From Phase 2 the native job queue owns cancellation and this forwards to it —
    /// stopping in-flight work is the whole reason the queue lives in native code.
    @objc(cancelAll)
    public static func cancelAll() {
        // Intentionally empty until the queue lands.
    }

    // MARK: - NativeFileGateway

    @objc(pickPhotos:resolve:reject:)
    public static func pickPhotos(
        _ limit: Double,
        resolve: @escaping (Any?) -> Void,
        reject: @escaping (String?, String?, Error?) -> Void
    ) {
        Task { @MainActor in
            guard let presenter = topViewController() else {
                reject("unknown", "No view controller is available to present the picker.", nil)
                return
            }
            do {
                let picked = try await FileGateway.pickPhotos(limit: Int(limit), presenter: presenter)
                resolve(picked.map(\.dictionaryRepresentation))
            } catch let error as ConversionError {
                reject(error.code, error.errorDescription ?? error.code, error)
            } catch {
                reject("unknown", error.localizedDescription, error)
            }
        }
    }

    @objc(saveToPhotos:resolve:reject:)
    public static func saveToPhotos(
        _ uris: [String],
        resolve: @escaping (Any?) -> Void,
        reject: @escaping (String?, String?, Error?) -> Void
    ) {
        Task {
            do {
                try await FileGateway.saveToPhotos(urls: uris.map(fileURL(from:)))
                resolve(nil)
            } catch let error as ConversionError {
                reject(error.code, error.errorDescription ?? error.code, error)
            } catch {
                // A denied add-only authorisation surfaces here; give it the code the
                // UI knows how to turn into a "grant this in Settings" message.
                reject("permissionDenied", error.localizedDescription, error)
            }
        }
    }

    @objc(pickDocuments:allowMultiple:resolve:reject:)
    public static func pickDocuments(
        _ utisOrMimeTypes: [String],
        allowMultiple: Bool,
        resolve: @escaping (Any?) -> Void,
        reject: @escaping (String?, String?, Error?) -> Void
    ) {
        Task { @MainActor in
            guard let presenter = topViewController() else {
                reject("unknown", "No view controller is available to present the picker.", nil)
                return
            }
            // JavaScript sends UTIs on iOS and MIME types on Android from one shared
            // list, so accept either and drop anything this platform does not know.
            let types = utisOrMimeTypes.compactMap { value -> UTType? in
                UTType(value) ?? UTType(mimeType: value)
            }
            do {
                let picked = try await FileGateway.pickDocuments(
                    contentTypes: types,
                    allowMultiple: allowMultiple,
                    presenter: presenter
                )
                resolve(picked.map(\.dictionaryRepresentation))
            } catch let error as ConversionError {
                reject(error.code, error.errorDescription ?? error.code, error)
            } catch {
                reject("unknown", error.localizedDescription, error)
            }
        }
    }

    @objc(ensureLocal:resolve:reject:)
    public static func ensureLocal(
        _ uri: String,
        resolve: @escaping (Any?) -> Void,
        reject: @escaping (String?, String?, Error?) -> Void
    ) {
        run(resolve: resolve, reject: reject) {
            try FileGateway.ensureLocalSync(fileURL(from: uri)).absoluteString
        }
    }

    @objc(saveToDownloads:resolve:reject:)
    public static func saveToDownloads(
        _ uris: [String],
        resolve: @escaping (Any?) -> Void,
        reject: @escaping (String?, String?, Error?) -> Void
    ) {
        Task { @MainActor in
            guard let presenter = topViewController() else {
                reject("unknown", "No view controller is available to present the picker.", nil)
                return
            }
            do {
                let saved = try await FileGateway.saveToDownloads(
                    urls: uris.map(fileURL(from:)),
                    presenter: presenter
                )
                resolve(saved)
            } catch {
                reject("unknown", error.localizedDescription, error)
            }
        }
    }

    @objc(createZip:zipName:resolve:reject:)
    public static func createZip(
        _ uris: [String],
        zipName: String,
        resolve: @escaping (Any?) -> Void,
        reject: @escaping (String?, String?, Error?) -> Void
    ) {
        run(resolve: resolve, reject: reject) {
            try FileGateway.createZip(urls: uris.map(fileURL(from:)), zipName: zipName).absoluteString
        }
    }

    @objc(freeDiskSpace:reject:)
    public static func freeDiskSpace(
        _ resolve: @escaping (Any?) -> Void,
        reject: @escaping (String?, String?, Error?) -> Void
    ) {
        run(resolve: resolve, reject: reject) { Double(FileGateway.freeDiskSpace()) }
    }

    @objc(sanitiseFilename:)
    public static func sanitiseFilename(_ name: String) -> String {
        FileGateway.sanitise(name)
    }

    @objc(resolveCollision:filename:resolve:reject:)
    public static func resolveCollision(
        _ directory: String,
        filename: String,
        resolve: @escaping (Any?) -> Void,
        reject: @escaping (String?, String?, Error?) -> Void
    ) {
        run(resolve: resolve, reject: reject) {
            FileGateway.resolveCollision(
                directory: fileURL(from: directory),
                filename: FileGateway.sanitise(filename)
            ).absoluteString
        }
    }

    @objc(clearTemporaryFiles:reject:)
    public static func clearTemporaryFiles(
        _ resolve: @escaping (Any?) -> Void,
        reject: @escaping (String?, String?, Error?) -> Void
    ) {
        run(resolve: resolve, reject: reject) {
            try FileGateway.clearTemporaryFiles()
            return nil
        }
    }

    // MARK: - Helpers

    /// Accepts both `file://` URLs and bare paths, because the two arrive from
    /// different places and a converter that only handles one of them fails obscurely.
    private static func fileURL(from uri: String) -> URL {
        if uri.hasPrefix("file://"), let url = URL(string: uri) { return url }
        return URL(fileURLWithPath: uri)
    }

    private static func unreadablePlaceholder(uri: String) -> [String: Any] {
        var placeholder = DetectedFile(
            uri: uri,
            displayName: (uri as NSString).lastPathComponent
        )
        placeholder.reason = "This file could not be opened."
        return placeholder.dictionaryRepresentation
    }

    @MainActor
    private static func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }

        guard let root = scene?.windows.first(where: \.isKeyWindow)?.rootViewController else {
            return nil
        }
        var top = root
        while let presented = top.presentedViewController { top = presented }
        return top
    }
}
