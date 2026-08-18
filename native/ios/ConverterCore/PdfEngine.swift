// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import CoreGraphics
import Foundation
import ImageIO
import PDFKit
import UIKit
import UniformTypeIdentifiers

/// PDF in both directions, plus the page utilities.
///
/// Everything here is PDFKit, which on iOS is a complete object-level PDF
/// implementation: merging, splitting and reordering copy page objects rather than
/// repainting them, so text stays selectable and searchable and a 40 MB scan does not
/// have to be rasterised to move one page. `compress` is the single exception, and it
/// says so — no platform API can rewrite an embedded image stream in place.
///
/// Encrypted documents are handled through short-lived sessions. A password is verified
/// once, the unlocked document is held in memory for as long as the user is working with
/// it, and the password itself is never written to disk, to the history store, or to a
/// log. Every entry point resolves its document through `document(for:)`, so a file the
/// user has already unlocked stays usable without widening any signature to carry a
/// password around.
public enum PdfEngine {

    // MARK: - Sessions

    private final class Session {
        let uri: String
        let document: PDFDocument

        init(uri: String, document: PDFDocument) {
            self.uri = uri
            self.document = document
        }
    }

    private static let lock = NSLock()
    private static var sessions: [String: Session] = [:]

    /// Verifies a password and returns an opaque handle.
    ///
    /// The handle is what crosses the bridge; the password does not come back out.
    public static func unlock(url: URL, password: String) throws -> String {
        guard let document = PDFDocument(url: url) else {
            throw ConversionError.unreadable(url.lastPathComponent)
        }

        if document.isLocked, !document.unlock(withPassword: password) {
            throw ConversionError.wrongPassword
        }

        let handle = "pdf-\(UUID().uuidString)"
        lock.lock()
        sessions[handle] = Session(uri: url.absoluteString, document: document)
        lock.unlock()
        return handle
    }

    /// Drops the unlocked document.
    ///
    /// PDFKit owns the decrypted buffers, so this releases them rather than wiping them
    /// — the honest description is that the app stops holding the document, not that the
    /// key material is scrubbed from memory, which no public API allows.
    public static func closeSession(_ handle: String) {
        lock.lock()
        sessions.removeValue(forKey: handle)
        lock.unlock()
    }

    private static func session(_ handle: String) -> Session? {
        lock.lock()
        defer { lock.unlock() }
        return sessions[handle]
    }

    private static func sessionDocument(forURI uri: String) -> PDFDocument? {
        lock.lock()
        defer { lock.unlock() }
        return sessions.values.first { $0.uri == uri }?.document
    }

    /// The one way a document is opened.
    ///
    /// An already-unlocked session wins, so an encrypted file the user has unlocked can
    /// be merged or split without the caller having to thread a password through.
    private static func document(for url: URL, sessionHandle: String = "") throws -> PDFDocument {
        if !sessionHandle.isEmpty, let session = session(sessionHandle) {
            return session.document
        }
        if let unlocked = sessionDocument(forURI: url.absoluteString) {
            return unlocked
        }

        guard let document = PDFDocument(url: url) else {
            throw ConversionError.unreadable(url.lastPathComponent)
        }
        // `isLocked` rather than `isEncrypted`: a document encrypted with an empty user
        // password opens fine and asking for one would be a lie.
        if document.isLocked {
            throw ConversionError.passwordRequired
        }
        return document
    }

    // MARK: - Inspect

    /// Page count, page sizes and whether a password is required.
    ///
    /// Deliberately safe on a locked document: the count and the encryption state are
    /// readable without the password, which is exactly what the UI needs in order to
    /// decide whether to ask for one.
    public static func inspect(url: URL) throws -> [String: Any] {
        guard let document = PDFDocument(url: url) else {
            throw ConversionError.unreadable(url.lastPathComponent)
        }

        let unlocked = sessionDocument(forURI: url.absoluteString)
        let readable = unlocked ?? document
        let locked = unlocked == nil && document.isLocked

        var pages: [[String: Any]] = []
        if !locked {
            for index in 0..<readable.pageCount {
                guard let page = readable.page(at: index) else { continue }
                let box = page.bounds(for: .mediaBox)
                pages.append([
                    "index": index,
                    "widthPoints": Double(box.width),
                    "heightPoints": Double(box.height),
                    "rotation": page.rotation,
                ])
            }
        }

        return [
            "uri": url.absoluteString,
            "pageCount": locked ? 0 : readable.pageCount,
            "isEncrypted": document.isEncrypted,
            "needsPassword": locked,
            "pages": pages,
            "title": (readable.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String) ?? "",
        ]
    }

    // MARK: - Render

    public struct RenderOptions {
        public var pageRanges: String = ""
        public var dpi: Double = 150
        public var format: String = "jpeg"
        public var quality: Int = 90
        public var outputDirectory: URL?
        public var namePrefix: String = ""

        public init(dictionary: [String: Any]) {
            pageRanges = dictionary["pageRanges"] as? String ?? ""
            // Clamped rather than trusted: 1200 DPI on an A4 page is a 100-megapixel
            // bitmap, which is a crash rather than a document.
            dpi = min(max(dictionary["dpi"] as? Double ?? 150, 36), 600)
            format = dictionary["format"] as? String ?? "jpeg"
            quality = min(max(dictionary["quality"] as? Int ?? 90, 1), 100)
            namePrefix = dictionary["namePrefix"] as? String ?? ""
            if let directory = dictionary["outputDirectory"] as? String, !directory.isEmpty {
                outputDirectory = URL(fileURLWithPath: directory.replacingOccurrences(of: "file://", with: ""))
            }
        }
    }

    /// Renders pages to image files, one at a time.
    ///
    /// Each page is drawn, encoded and released before the next begins, so peak memory
    /// is one page rather than one document. That is the difference between exporting a
    /// 400-page scan and being killed a third of the way through it.
    public static func renderPages(
        url: URL,
        sessionHandle: String,
        options: RenderOptions
    ) throws -> [String: Any] {
        let started = DispatchTime.now()
        let document = try document(for: url, sessionHandle: sessionHandle)

        guard let type = RasterCodec.utType(for: options.format) else {
            throw ConversionError.unsupportedTarget(options.format)
        }

        let directory = try options.outputDirectory ?? RasterCodec.managedOutputDirectory()
        let indices = PdfPageGeometry.expand(ranges: options.pageRanges, pageCount: document.pageCount)
        guard !indices.isEmpty else {
            throw ConversionError.corrupt("No pages matched that range.")
        }

        let stem = options.namePrefix.isEmpty
            ? url.deletingPathExtension().lastPathComponent
            : options.namePrefix
        let ext = FormatTable.spec(options.format)?.extensions.first ?? options.format

        var results: [[String: Any]] = []

        for index in indices {
            guard let page = document.page(at: index) else { continue }

            try autoreleasepool {
                let image = render(page: page, dpi: options.dpi)
                let name = FileGateway.sanitise("\(stem)-\(String(format: "%03d", index + 1))")
                let output = FileGateway.resolveCollision(directory: directory, filename: "\(name).\(ext)")

                try write(image: image, to: output, type: type, quality: options.quality)

                results.append([
                    "sourceIndex": index,
                    "outputUri": output.absoluteString,
                    "outputDisplayName": output.lastPathComponent,
                    "format": options.format,
                    "byteSize": byteSize(of: output),
                    "pixelWidth": image.width,
                    "pixelHeight": image.height,
                    "qualityUsed": options.quality,
                    "elapsedMs": 0,
                ])
            }
        }

        return [
            "results": results,
            "elapsedMs": elapsedMs(since: started),
        ]
    }

    /// Draws one page at the requested density.
    ///
    /// `PDFPage.draw(with:to:)` applies the page's own rotation, and `bounds(for:)`
    /// reports the rotated box, so a page scanned sideways comes out the right way up
    /// without special handling here.
    private static func render(page: PDFPage, dpi: Double) -> CGImage {
        let box = page.bounds(for: .mediaBox)
        let scale = dpi / 72.0
        let size = CGSize(width: max(box.width * scale, 1), height: max(box.height * scale, 1))

        let format = UIGraphicsImageRendererFormat.preferred()
        format.scale = 1
        // A PDF page has no background of its own. Without painting one, every page
        // exported to a format with an alpha channel comes out transparent, and every
        // page exported to one without comes out black.
        format.opaque = true

        let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            context.cgContext.translateBy(x: 0, y: size.height)
            context.cgContext.scaleBy(x: scale, y: -scale)
            page.draw(with: .mediaBox, to: context.cgContext)
        }

        return image.cgImage ?? UIGraphicsImageRenderer(size: size).image { _ in }.cgImage!
    }

    // MARK: - Compose

    public struct ComposeOptions {
        public var pageSize: String = "a4"
        public var orientation: String = "auto"
        public var fitMode: String = "fit"
        public var marginPoints: Double = 36
        public var nUp: Int = 1
        public var gutterPoints: Double = 12
        public var dpi: Double = 150
        public var backgroundColor: String = "#FFFFFF"

        public init(dictionary: [String: Any]) {
            pageSize = dictionary["pageSize"] as? String ?? "a4"
            orientation = dictionary["orientation"] as? String ?? "auto"
            fitMode = dictionary["fitMode"] as? String ?? "fit"
            marginPoints = max(dictionary["marginPoints"] as? Double ?? 36, 0)
            nUp = dictionary["nUp"] as? Int ?? 1
            gutterPoints = max(dictionary["gutterPoints"] as? Double ?? 12, 0)
            dpi = min(max(dictionary["dpi"] as? Double ?? 150, 36), 600)
            backgroundColor = dictionary["backgroundColor"] as? String ?? "#FFFFFF"
        }
    }

    /// Composes images into a PDF.
    ///
    /// Written through `UIGraphicsPDFRenderer`, so each image is drawn as a page rather
    /// than embedded whole — which is what lets margins, fit modes and N-up mean
    /// anything. Images are decoded one page at a time.
    public static func composeFromImages(
        imageURLs: [URL],
        outputURL: URL,
        options: ComposeOptions
    ) throws -> [String: Any] {
        let started = DispatchTime.now()
        guard !imageURLs.isEmpty else {
            throw ConversionError.corrupt("A PDF needs at least one image.")
        }

        let perPage = max(options.nUp, 1)
        // Reuses the flattening parser, so a page background and a transparency fill
        // are specified the same way and fall back to white for the same reason.
        let background = CGColor.fromHex(options.backgroundColor, colorSpace: CGColorSpaceCreateDeviceRGB())
        var pageCount = 0

        let data = try renderPDF { context in
            var offset = 0
            while offset < imageURLs.count {
                let slice = Array(imageURLs[offset..<min(offset + perPage, imageURLs.count)])
                offset += perPage

                try autoreleasepool {
                    let images = slice.compactMap { decode(url: $0) }
                    guard let first = images.first else { return }

                    let page = PdfPageGeometry.page(
                        named: options.pageSize,
                        orientation: options.orientation,
                        // With several images to a page, the paper is chosen from the
                        // first — mixing orientations inside one sheet is not a thing.
                        imageWidth: Double(first.width),
                        imageHeight: Double(first.height),
                        dpi: options.dpi
                    )
                    let bounds = CGRect(origin: .zero, size: page.cgSize)
                    context.beginPage(withBounds: bounds, pageInfo: [:])
                    pageCount += 1

                    context.cgContext.setFillColor(background)
                    context.cgContext.fill(bounds)

                    let content = bounds.insetBy(dx: options.marginPoints, dy: options.marginPoints)
                    let slots = PdfPageGeometry.slots(
                        in: content.isNull || content.width <= 0 || content.height <= 0 ? bounds : content,
                        count: perPage,
                        gutter: options.gutterPoints
                    )

                    for (position, image) in images.enumerated() where position < slots.count {
                        let frame = PdfPageGeometry.placement(
                            imageWidth: Double(image.width),
                            imageHeight: Double(image.height),
                            slot: slots[position],
                            mode: options.fitMode
                        )
                        draw(image: image, in: frame, clippedTo: slots[position], context: context.cgContext)
                    }
                }
            }
        }

        try write(data: data, to: outputURL)

        return result(outputURL: outputURL, pageCount: pageCount, started: started)
    }

    // MARK: - Merge

    /// Concatenates documents, page objects and all.
    ///
    /// Nothing is rasterised: text, links and bookmarks survive because the pages are
    /// copied rather than repainted.
    public static func merge(urls: [URL], outputURL: URL) throws -> [String: Any] {
        let started = DispatchTime.now()
        guard urls.count >= 2 else {
            throw ConversionError.corrupt("Merging needs at least two documents.")
        }

        let merged = PDFDocument()
        var cursor = 0

        for url in urls {
            let source = try document(for: url)
            for index in 0..<source.pageCount {
                guard let page = source.page(at: index)?.copy() as? PDFPage else { continue }
                merged.insert(page, at: cursor)
                cursor += 1
            }
        }

        guard cursor > 0 else { throw ConversionError.corrupt("Those documents had no pages.") }
        guard merged.write(to: outputURL) else { throw ConversionError.diskFull }

        return result(outputURL: outputURL, pageCount: merged.pageCount, started: started)
    }

    // MARK: - Split

    public struct SplitOptions {
        public var ranges: String = ""
        public var everyNPages: Int = 1
        public var namePrefix: String = ""

        public init(dictionary: [String: Any]) {
            ranges = dictionary["ranges"] as? String ?? ""
            everyNPages = max(dictionary["everyNPages"] as? Int ?? 1, 1)
            namePrefix = dictionary["namePrefix"] as? String ?? ""
        }
    }

    /// Splits by explicit ranges, or every N pages when none are given.
    ///
    /// `1-3,7,9-` produces three documents, in the order written. Ranges are how people
    /// think about pulling a chapter out; every-N is how they think about breaking a
    /// scan into single pages.
    public static func split(
        url: URL,
        outputDirectory: URL,
        options: SplitOptions
    ) throws -> [String: Any] {
        let started = DispatchTime.now()
        let source = try document(for: url)
        guard source.pageCount > 0 else { throw ConversionError.corrupt(url.lastPathComponent) }

        var groups: [[Int]] = []
        if options.ranges.trimmingCharacters(in: .whitespaces).isEmpty {
            var index = 0
            while index < source.pageCount {
                groups.append(Array(index..<min(index + options.everyNPages, source.pageCount)))
                index += options.everyNPages
            }
        } else {
            for part in options.ranges.split(separator: ",") {
                let pages = PdfPageGeometry.expand(ranges: String(part), pageCount: source.pageCount)
                if !pages.isEmpty { groups.append(pages) }
            }
        }

        guard !groups.isEmpty else { throw ConversionError.corrupt("No pages matched that range.") }

        let stem = options.namePrefix.isEmpty
            ? url.deletingPathExtension().lastPathComponent
            : options.namePrefix
        var outputs: [[String: Any]] = []

        for (position, pages) in groups.enumerated() {
            try autoreleasepool {
                let part = PDFDocument()
                var cursor = 0
                for index in pages {
                    guard let page = source.page(at: index)?.copy() as? PDFPage else { continue }
                    part.insert(page, at: cursor)
                    cursor += 1
                }
                guard cursor > 0 else { return }

                let name = FileGateway.sanitise("\(stem)-\(String(format: "%03d", position + 1))")
                let output = FileGateway.resolveCollision(directory: outputDirectory, filename: "\(name).pdf")
                guard part.write(to: output) else { throw ConversionError.diskFull }

                outputs.append([
                    "outputUri": output.absoluteString,
                    "outputDisplayName": output.lastPathComponent,
                    "pageCount": part.pageCount,
                    "byteSize": byteSize(of: output),
                    // The pages this part came from, one-based, so the UI can label it
                    // "pages 4-6" rather than "part 2".
                    "sourcePages": pages.map { $0 + 1 },
                ])
            }
        }

        return [
            "results": outputs,
            "elapsedMs": elapsedMs(since: started),
        ]
    }

    // MARK: - Edit

    /// Deletes, rotates and reorders in one pass.
    ///
    /// One pass matters: applied separately, a delete would invalidate the indices the
    /// rotate and reorder were written against. Everything here is resolved against the
    /// original page numbering, which is the numbering the user was looking at.
    public static func editPages(
        url: URL,
        outputURL: URL,
        operations: [String: Any]
    ) throws -> [String: Any] {
        let started = DispatchTime.now()
        let source = try document(for: url)

        let deleted = Set((operations["delete"] as? [Int]) ?? [])
        let rotations = (operations["rotate"] as? [String: Any]) ?? [:]
        let requestedOrder = (operations["order"] as? [Int]) ?? []

        // An explicit order wins; anything it omits keeps its original position after
        // the pages it does mention, so a partial reorder is not a silent delete.
        var order: [Int] = requestedOrder.filter { $0 >= 0 && $0 < source.pageCount }
        let mentioned = Set(order)
        order.append(contentsOf: (0..<source.pageCount).filter { !mentioned.contains($0) })

        let edited = PDFDocument()
        var cursor = 0

        for index in order where !deleted.contains(index) {
            guard let page = source.page(at: index)?.copy() as? PDFPage else { continue }
            if let delta = rotationDelta(rotations, index: index) {
                // Normalised into 0/90/180/270: PDF readers are entitled to reject
                // anything else, and a negative rotation is a common way to express
                // "anticlockwise".
                page.rotation = (((page.rotation + delta) % 360) + 360) % 360
            }
            edited.insert(page, at: cursor)
            cursor += 1
        }

        guard cursor > 0 else {
            throw ConversionError.corrupt("That would delete every page.")
        }
        guard edited.write(to: outputURL) else { throw ConversionError.diskFull }

        return result(outputURL: outputURL, pageCount: edited.pageCount, started: started)
    }

    private static func rotationDelta(_ rotations: [String: Any], index: Int) -> Int? {
        // Object keys cross the bridge as strings even when they were written as numbers.
        if let value = rotations["\(index)"] as? Int { return value }
        if let value = rotations["\(index)"] as? Double { return Int(value) }
        return nil
    }

    // MARK: - Compress

    public struct CompressOptions {
        public var dpi: Double = 150
        public var quality: Int = 70
        public var grayscale: Bool = false

        public init(dictionary: [String: Any]) {
            dpi = min(max(dictionary["dpi"] as? Double ?? 150, 36), 600)
            quality = min(max(dictionary["quality"] as? Int ?? 70, 1), 100)
            grayscale = dictionary["grayscale"] as? Bool ?? false
        }
    }

    /// Rasterises and re-encodes every page.
    ///
    /// This is the one operation here that loses something, and it loses a lot: text
    /// stops being selectable, searchable and accessible, because each page becomes a
    /// photograph of itself. No platform API can rewrite an embedded image stream in
    /// place, so the alternative is not a better compressor but no feature. The UI warns
    /// before applying rather than letting it be discovered afterwards.
    public static func compress(
        url: URL,
        outputURL: URL,
        options: CompressOptions
    ) throws -> [String: Any] {
        let started = DispatchTime.now()
        let source = try document(for: url)
        guard source.pageCount > 0 else { throw ConversionError.corrupt(url.lastPathComponent) }

        let before = byteSize(of: url)
        var pageCount = 0

        let data = try renderPDF { context in
            for index in 0..<source.pageCount {
                guard let page = source.page(at: index) else { continue }

                try autoreleasepool {
                    let box = page.bounds(for: .mediaBox)
                    // The page keeps its original dimensions in points. Only the pixels
                    // behind it get cheaper, so the document still prints at its
                    // intended size.
                    context.beginPage(withBounds: CGRect(origin: .zero, size: box.size), pageInfo: [:])
                    pageCount += 1

                    let rendered = render(page: page, dpi: options.dpi)
                    let recompressed = try recompress(
                        rendered,
                        quality: options.quality,
                        grayscale: options.grayscale
                    )
                    draw(
                        image: recompressed,
                        in: CGRect(origin: .zero, size: box.size),
                        clippedTo: CGRect(origin: .zero, size: box.size),
                        context: context.cgContext
                    )
                }
            }
        }

        try write(data: data, to: outputURL)

        var payload = result(outputURL: outputURL, pageCount: pageCount, started: started)
        payload["beforeByteSize"] = before
        return payload
    }

    /// Round-trips through a JPEG encoder so the page carries its lossy weight into the
    /// document, rather than being embedded as a full-fidelity bitmap.
    private static func recompress(_ image: CGImage, quality: Int, grayscale: Bool) throws -> CGImage {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            data, UTType.jpeg.identifier as CFString, 1, nil
        ) else {
            throw ConversionError.unsupportedTarget("jpeg")
        }

        let source = grayscale ? (desaturate(image) ?? image) : image
        CGImageDestinationAddImage(destination, source, [
            kCGImageDestinationLossyCompressionQuality: Double(quality) / 100.0,
        ] as CFDictionary)

        guard CGImageDestinationFinalize(destination),
              let reread = CGImageSourceCreateWithData(data as CFData, nil),
              let output = CGImageSourceCreateImageAtIndex(reread, 0, nil)
        else {
            throw ConversionError.corrupt("Could not re-encode a page.")
        }
        return output
    }

    private static func desaturate(_ image: CGImage) -> CGImage? {
        guard let context = CGContext(
            data: nil,
            width: image.width,
            height: image.height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else { return nil }

        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        return context.makeImage()
    }

    // MARK: - Shared helpers

    /// PDF pages are written into memory and flushed once, because
    /// `UIGraphicsPDFRenderer` has no streaming form. Peak cost is the finished document
    /// plus one page's bitmap, not one bitmap per page.
    private static func renderPDF(_ body: (UIGraphicsPDFRendererContext) throws -> Void) throws -> Data {
        var thrown: Error?
        let data = UIGraphicsPDFRenderer(bounds: .zero).pdfData { context in
            do { try body(context) } catch { thrown = error }
        }
        if let thrown { throw thrown }
        return data
    }

    private static func decode(url: URL) -> CGImage? {
        guard let source = CGImageSourceCreateWithURL(
            url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary
        ) else { return nil }
        // Orientation is applied here rather than ignored, so a photo taken sideways is
        // the right way up in the document.
        return CGImageSourceCreateImageAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: false,
        ] as CFDictionary).map { applyOrientation($0, source: source) } ?? nil
    }

    private static func applyOrientation(_ image: CGImage, source: CGImageSource) -> CGImage {
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        let raw = properties?[kCGImagePropertyOrientation] as? UInt32 ?? 1
        guard raw > 1, let orientation = CGImagePropertyOrientation(rawValue: raw) else { return image }

        let rotated = raw >= 5
        let size = rotated
            ? CGSize(width: image.height, height: image.width)
            : CGSize(width: image.width, height: image.height)

        let format = UIGraphicsImageRendererFormat.preferred()
        format.scale = 1
        format.opaque = false

        let output = UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIImage(cgImage: image, scale: 1, orientation: uiOrientation(orientation))
                .draw(in: CGRect(origin: .zero, size: size))
        }
        return output.cgImage ?? image
    }

    private static func uiOrientation(_ value: CGImagePropertyOrientation) -> UIImage.Orientation {
        switch value {
        case .up: return .up
        case .upMirrored: return .upMirrored
        case .down: return .down
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .right: return .right
        case .rightMirrored: return .rightMirrored
        case .left: return .left
        @unknown default: return .up
        }
    }

    /// Draws bottom-up, because a PDF context's origin is bottom-left while a CGImage is
    /// stored top-down. Clipped to the slot so `fill` crops rather than bleeding into
    /// its neighbour.
    private static func draw(image: CGImage, in frame: CGRect, clippedTo slot: CGRect, context: CGContext) {
        context.saveGState()
        context.clip(to: slot)
        context.translateBy(x: 0, y: frame.midY * 2)
        context.scaleBy(x: 1, y: -1)
        context.draw(image, in: frame)
        context.restoreGState()
    }

    private static func write(image: CGImage, to url: URL, type: UTType, quality: Int) throws {
        guard let destination = CGImageDestinationCreateWithURL(
            url as CFURL, type.identifier as CFString, 1, nil
        ) else {
            throw ConversionError.diskFull
        }
        CGImageDestinationAddImage(destination, image, [
            kCGImageDestinationLossyCompressionQuality: Double(quality) / 100.0,
        ] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else {
            throw ConversionError.diskFull
        }
    }

    /// Written to a sibling path and moved into place, so a process death mid-write
    /// cannot leave a half-written document where a whole one is expected.
    private static func write(data: Data, to url: URL) throws {
        let temporary = url.deletingLastPathComponent()
            .appendingPathComponent(".\(UUID().uuidString).pdf")
        do {
            try data.write(to: temporary, options: .atomic)
            if FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.removeItem(at: url)
            }
            try FileManager.default.moveItem(at: temporary, to: url)
        } catch {
            try? FileManager.default.removeItem(at: temporary)
            throw ConversionError.diskFull
        }
    }

    private static func result(outputURL: URL, pageCount: Int, started: DispatchTime) -> [String: Any] {
        [
            "outputUri": outputURL.absoluteString,
            "outputDisplayName": outputURL.lastPathComponent,
            "pageCount": pageCount,
            "byteSize": byteSize(of: outputURL),
            "elapsedMs": elapsedMs(since: started),
        ]
    }

    private static func byteSize(of url: URL) -> Int64 {
        (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int64) as? Int64 ?? 0
    }

    private static func elapsedMs(since started: DispatchTime) -> Double {
        Double(DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1_000_000
    }
}
