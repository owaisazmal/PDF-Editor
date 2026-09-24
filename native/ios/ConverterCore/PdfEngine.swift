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
        options: RenderOptions,
        progress: (Int, Int) -> Void = { _, _ in }
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

        for (position, index) in indices.enumerated() {
            defer { progress(position + 1, indices.count) }
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
        // Poster-sized pages get a lower density rather than an impossible bitmap.
        let requested = dpi / 72.0
        let pixels = Double(max(box.width, 1) * max(box.height, 1)) * requested * requested
        let scale = pixels > maxPagePixels ? requested * (maxPagePixels / pixels).squareRoot() : requested
        let size = CGSize(width: max(box.width * scale, 1), height: max(box.height * scale, 1))

        let format = UIGraphicsImageRendererFormat.preferred()
        format.scale = 1
        // sRGB, which is how a JPEG page or exported image is read everywhere else.
        format.preferredRange = .standard
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
    /// Each page is streamed to disk with its image as a JPEG no larger than its frame; the
    /// old in-memory build grew with every photo and doubled the file size.
    public static func composeFromImages(
        imageURLs: [URL],
        outputURL: URL,
        options: ComposeOptions,
        progress: (Int, Int) -> Void = { _, _ in }
    ) throws -> [String: Any] {
        let started = DispatchTime.now()
        guard !imageURLs.isEmpty else {
            throw ConversionError.corrupt("A PDF needs at least one image.")
        }

        let perPage = max(options.nUp, 1)
        // Reuses the flattening parser, so a page background and a transparency fill
        // are specified the same way and fall back to white for the same reason.
        let background = CGColor.fromHex(options.backgroundColor, colorSpace: srgb)
        let slices = stride(from: 0, to: imageURLs.count, by: perPage).map {
            Array(imageURLs[$0..<min($0 + perPage, imageURLs.count)])
        }

        let pageCount = try writeImagePages(to: outputURL) { writer in
            for (sliceIndex, slice) in slices.enumerated() {
                try autoreleasepool {
                    defer { progress(sliceIndex + 1, slices.count) }

                    // Upright dimensions, so a sideways-stored portrait photo gets a portrait page.
                    let shapes = slice.compactMap { url in orientedSize(of: url).map { (url, $0) } }
                    guard let first = shapes.first?.1 else { return }

                    let page = PdfPageGeometry.page(
                        named: options.pageSize,
                        orientation: options.orientation,
                        imageWidth: first.width,
                        imageHeight: first.height,
                        dpi: options.dpi
                    )
                    let bounds = CGRect(origin: .zero, size: page.cgSize)
                    let content = bounds.insetBy(dx: options.marginPoints, dy: options.marginPoints)
                    let slots = PdfPageGeometry.slots(
                        in: content.isNull || content.width <= 0 || content.height <= 0 ? bounds : content,
                        count: perPage,
                        gutter: options.gutterPoints
                    )

                    var images: [PdfStreamWriter.Image] = []
                    for (position, shape) in shapes.enumerated() where position < slots.count {
                        let frame = PdfPageGeometry.placement(
                            imageWidth: shape.1.width,
                            imageHeight: shape.1.height,
                            slot: slots[position],
                            mode: options.fitMode
                        )
                        // Pixels the frame can show at the chosen density, capped at the source.
                        let needed = max(frame.width, frame.height) / 72 * options.dpi
                        let longest = min(needed, max(shape.1.width, shape.1.height))
                        guard let jpeg = embeddableJpeg(
                            url: shape.0,
                            maxPixelSize: Int(longest.rounded(.up)),
                            background: background
                        ) else { continue }
                        images.append(PdfStreamWriter.Image(
                            jpeg: jpeg.data,
                            pixelWidth: jpeg.width,
                            pixelHeight: jpeg.height,
                            grayscale: false,
                            frame: frame,
                            clip: slots[position]
                        ))
                    }
                    guard !images.isEmpty else { return }
                    try writer.addPage(size: bounds.size, background: components(of: background), images: images)
                }
            }
        }
        guard pageCount > 0 else {
            throw ConversionError.corrupt("None of those images could be read.")
        }

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
        options: SplitOptions,
        progress: (Int, Int) -> Void = { _, _ in }
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
            defer { progress(position + 1, groups.count) }
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
        options: CompressOptions,
        progress: (Int, Int) -> Void = { _, _ in }
    ) throws -> [String: Any] {
        let started = DispatchTime.now()
        let source = try document(for: url)
        guard source.pageCount > 0 else { throw ConversionError.corrupt(url.lastPathComponent) }

        let before = byteSize(of: url)

        let pageCount = try writeImagePages(to: outputURL) { writer in
            for index in 0..<source.pageCount {
                defer { progress(index + 1, source.pageCount) }
                guard let page = source.page(at: index) else { continue }

                try autoreleasepool {
                    // The page keeps its original dimensions in points. Only the pixels
                    // behind it get cheaper, so the document still prints at its
                    // intended size.
                    let box = page.bounds(for: .mediaBox)
                    let rendered = render(page: page, dpi: options.dpi)
                    let image = options.grayscale ? (desaturate(rendered) ?? rendered) : rendered
                    guard let jpeg = jpegData(image, quality: Double(options.quality) / 100),
                          let components = PdfStreamWriter.jpegComponents(jpeg),
                          components == 1 || components == 3
                    else {
                        throw ConversionError.corrupt("Could not re-encode a page.")
                    }
                    try writer.addPage(size: box.size, background: (1, 1, 1), images: [
                        PdfStreamWriter.Image(
                            jpeg: jpeg,
                            pixelWidth: image.width,
                            pixelHeight: image.height,
                            grayscale: components == 1,
                            frame: CGRect(origin: .zero, size: box.size),
                            clip: nil
                        ),
                    ])
                }
            }
        }

        var payload = result(outputURL: outputURL, pageCount: pageCount, started: started)
        payload["beforeByteSize"] = before
        return payload
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

    private static let srgb = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()

    /// Builds a document of JPEG pages beside `url`, moves it into place once complete, and
    /// returns the page count.
    private static func writeImagePages(to url: URL, _ build: (PdfStreamWriter) throws -> Void) throws -> Int {
        let temporary = url.deletingLastPathComponent()
            .appendingPathComponent(".\(UUID().uuidString).pdf")
        do {
            let writer = try PdfStreamWriter(url: temporary)
            try build(writer)
            guard writer.pageCount > 0 else {
                try? FileManager.default.removeItem(at: temporary)
                return 0
            }
            try writer.finish()
            if FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.removeItem(at: url)
            }
            try FileManager.default.moveItem(at: temporary, to: url)
            return writer.pageCount
        } catch let error as ConversionError {
            try? FileManager.default.removeItem(at: temporary)
            throw error
        } catch {
            try? FileManager.default.removeItem(at: temporary)
            throw ConversionError.diskFull
        }
    }

    private static func components(of color: CGColor) -> (red: Double, green: Double, blue: Double) {
        let values = (color.converted(to: srgb, intent: .defaultIntent, options: nil) ?? color).components ?? []
        guard values.count >= 3 else { return (1, 1, 1) }
        return (Double(values[0]), Double(values[1]), Double(values[2]))
    }

    /// The longest edge an embedded image keeps.
    private static let maxEmbedEdge = 4096

    /// The most pixels one page is ever rendered at, about 160 MB of bitmap.
    private static let maxPagePixels: Double = 40_000_000

    /// Pixel dimensions as the image is meant to be seen, EXIF rotation applied.
    private static func orientedSize(of url: URL) -> (width: Double, height: Double)? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0
        else { return nil }
        let orientation = properties[kCGImagePropertyOrientation] as? Int ?? 1
        return orientation >= 5 ? (Double(height), Double(width)) : (Double(width), Double(height))
    }

    /// One image as upright sRGB JPEG data no larger than needed; a JPEG that already fits
    /// is used as it is.
    private static func embeddableJpeg(
        url: URL,
        maxPixelSize: Int,
        background: CGColor
    ) -> (data: Data, width: Int, height: Int)? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else {
            return nil
        }
        let limit = max(1, min(maxPixelSize, maxEmbedEdge))
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] ?? [:]
        let width = properties[kCGImagePropertyPixelWidth] as? Int ?? 0
        let height = properties[kCGImagePropertyPixelHeight] as? Int ?? 0
        let orientation = properties[kCGImagePropertyOrientation] as? Int ?? 1
        let profile = properties[kCGImagePropertyProfileName] as? String

        if CGImageSourceGetType(source) as String? == UTType.jpeg.identifier,
           orientation == 1,
           profile == nil || profile?.hasPrefix("sRGB") == true,
           max(width, height) <= min(limit * 5 / 4, maxEmbedEdge),
           let original = try? Data(contentsOf: url, options: .mappedIfSafe),
           PdfStreamWriter.jpegComponents(original) == 3 {
            return (original, width, height)
        }

        guard let decoded = CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: limit,
            kCGImageSourceShouldCacheImmediately: false,
        ] as CFDictionary),
              let opaque = opaqueSRGB(decoded, background: background),
              let data = jpegData(opaque, quality: 0.9)
        else { return nil }
        return (data, opaque.width, opaque.height)
    }

    /// Redrawn into opaque sRGB: JPEG has no alpha, and wide-gamut pixels read as plain RGB
    /// look washed out.
    private static func opaqueSRGB(_ image: CGImage, background: CGColor) -> CGImage? {
        guard let context = CGContext(
            data: nil,
            width: image.width,
            height: image.height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: srgb,
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
        ) else { return nil }
        let rect = CGRect(x: 0, y: 0, width: image.width, height: image.height)
        context.setFillColor(background)
        context.fill(rect)
        context.draw(image, in: rect)
        return context.makeImage()
    }

    private static func jpegData(_ image: CGImage, quality: Double) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            data, UTType.jpeg.identifier as CFString, 1, nil
        ) else { return nil }
        CGImageDestinationAddImage(destination, image, [
            kCGImageDestinationLossyCompressionQuality: quality,
        ] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return data as Data
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
