// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Decode, transform, encode.
///
/// The five things this gets right that converters commonly get wrong, in the order
/// they appear below:
///
///   1. **Orientation is baked into pixels.** A JPEG with orientation tag 6 is stored
///      rotated with a tag saying "turn me". Copying that tag forward and re-encoding
///      leaves the image sideways in any viewer that ignores it. The rotation is
///      applied to the pixels and the tag is reset to 1.
///   2. **Decoding is downsampled.** A 200-megapixel source is never fully realised in
///      memory; ImageIO decodes straight to the size actually needed.
///   3. **Transparency is composited, never dropped.** Flattening to a format without
///      an alpha channel fills first. A black background here is the single most
///      common one-star review in this category.
///   4. **Display P3 is converted to sRGB.** A P3 JPEG renders over-saturated anywhere
///      the profile is ignored, and users read that as our bug.
///   5. **Writes are atomic.** Output goes to a temporary file and is moved into place
///      only on success, so a process death mid-encode cannot leave a truncated file
///      where a finished one should be.
public enum RasterCodec {

    public struct Options: Sendable {
        public var targetFormat: String = "jpeg"
        public var quality: Int = 82
        public var targetByteSize: Int = 0
        public var resizeMode: String = "none"
        public var resizePercent: Double = 100
        public var maxWidth: Int = 0
        public var maxHeight: Int = 0
        public var exactWidth: Int = 0
        public var exactHeight: Int = 0
        public var allowUpscale: Bool = false
        public var rotate: Int = 0
        public var flipHorizontal: Bool = false
        public var flipVertical: Bool = false
        public var metadataMode: String = "keepExceptGps"
        public var convertToSrgb: Bool = true
        public var backgroundColor: String = "#FFFFFF"
        public var lossless: Bool = false
        public var frameIndex: Int = 0

        public init() {}

        /// Reads the validated options object sent from JavaScript. Every field has a
        /// default here as well, so a missing key degrades rather than throwing —
        /// validation already happened on the other side of the bridge.
        public init(dictionary: [String: Any]) {
            self.init()
            targetFormat = dictionary["targetFormat"] as? String ?? targetFormat
            quality = dictionary["quality"] as? Int ?? quality
            targetByteSize = dictionary["targetByteSize"] as? Int ?? 0
            rotate = dictionary["rotate"] as? Int ?? 0
            flipHorizontal = dictionary["flipHorizontal"] as? Bool ?? false
            flipVertical = dictionary["flipVertical"] as? Bool ?? false
            convertToSrgb = dictionary["convertToSrgb"] as? Bool ?? true
            lossless = dictionary["lossless"] as? Bool ?? false
            frameIndex = dictionary["frameIndex"] as? Int ?? 0

            if let resize = dictionary["resize"] as? [String: Any] {
                resizeMode = resize["mode"] as? String ?? "none"
                resizePercent = resize["percent"] as? Double ?? 100
                maxWidth = resize["maxWidth"] as? Int ?? 0
                maxHeight = resize["maxHeight"] as? Int ?? 0
                exactWidth = resize["exactWidth"] as? Int ?? 0
                exactHeight = resize["exactHeight"] as? Int ?? 0
                allowUpscale = resize["allowUpscale"] as? Bool ?? false
            }
            if let metadata = dictionary["metadata"] as? [String: Any] {
                metadataMode = metadata["mode"] as? String ?? "keepExceptGps"
            }
            if let background = dictionary["background"] as? [String: Any] {
                backgroundColor = background["color"] as? String ?? "#FFFFFF"
            }
        }
    }

    public struct Result: Sendable {
        public let outputURL: URL
        public let format: String
        public let byteSize: Int64
        public let pixelWidth: Int
        public let pixelHeight: Int
        public let qualityUsed: Int
        public let elapsedMs: Double

        public var dictionaryRepresentation: [String: Any] {
            [
                // Overwritten by the job queue with the file's position in the user's
                // selection. -1 means "converted on its own, not part of a batch".
                "sourceIndex": -1,
                "outputUri": outputURL.absoluteString,
                "outputDisplayName": outputURL.lastPathComponent,
                "format": format,
                "byteSize": Double(byteSize),
                "pixelWidth": pixelWidth,
                "pixelHeight": pixelHeight,
                "qualityUsed": qualityUsed,
                "elapsedMs": elapsedMs,
            ]
        }
    }

    // MARK: - Entry point

    public static func convert(
        inputURL: URL,
        outputURL requestedOutput: URL?,
        options: Options
    ) throws -> Result {
        let started = DispatchTime.now()

        guard let source = CGImageSourceCreateWithURL(
            inputURL as CFURL,
            [kCGImageSourceShouldCache: false] as CFDictionary
        ) else {
            throw ConversionError.unreadable(inputURL.lastPathComponent)
        }

        guard let destinationType = utType(for: options.targetFormat) else {
            throw ConversionError.unsupportedTarget(options.targetFormat)
        }

        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] ?? [:]
        let sourceWidth = properties[kCGImagePropertyPixelWidth] as? Int ?? 0
        let sourceHeight = properties[kCGImagePropertyPixelHeight] as? Int ?? 0
        guard sourceWidth > 0, sourceHeight > 0 else {
            throw ConversionError.corrupt(inputURL.lastPathComponent)
        }

        let orientation = properties[kCGImagePropertyOrientation] as? Int ?? 1
        let targetSize = resolveTargetSize(
            sourceWidth: sourceWidth,
            sourceHeight: sourceHeight,
            orientation: orientation,
            options: options
        )

        // Decoding straight to the needed size is what keeps a 200 MP source from
        // becoming a 200 MP allocation. `autoreleasepool` bounds the peak within a batch.
        let decoded = try autoreleasepool { () throws -> CGImage in
            try decode(source: source, frameIndex: options.frameIndex, maxPixelSize: max(targetSize.width, targetSize.height))
        }

        let transformed = try autoreleasepool { () throws -> CGImage in
            try render(
                decoded,
                orientation: orientation,
                extraRotation: options.rotate,
                flipHorizontal: options.flipHorizontal,
                flipVertical: options.flipVertical,
                targetSize: targetSize,
                flatten: !formatSupportsAlpha(options.targetFormat),
                backgroundColor: options.backgroundColor,
                convertToSrgb: options.convertToSrgb
            )
        }

        let outputURL = try resolveOutputURL(
            requested: requestedOutput,
            inputURL: inputURL,
            format: options.targetFormat
        )

        try ensureSpaceAvailable(for: outputURL, estimatedBytes: Int64(transformed.width * transformed.height * 4))

        let metadata = metadataDictionary(from: properties, options: options)
        let qualityUsed = try encodeAtomically(
            image: transformed,
            to: outputURL,
            type: destinationType,
            metadata: metadata,
            options: options
        )

        let byteSize = (try? FileManager.default.attributesOfItem(atPath: outputURL.path)[.size] as? NSNumber)??.int64Value ?? 0
        let elapsedMs = Double(DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1_000_000

        return Result(
            outputURL: outputURL,
            format: options.targetFormat,
            byteSize: byteSize,
            pixelWidth: transformed.width,
            pixelHeight: transformed.height,
            qualityUsed: qualityUsed,
            elapsedMs: elapsedMs
        )
    }

    // MARK: - Decode

    private static func decode(source: CGImageSource, frameIndex: Int, maxPixelSize: Int) throws -> CGImage {
        let index = min(max(frameIndex, 0), max(CGImageSourceGetCount(source) - 1, 0))

        var decodeOptions: [CFString: Any] = [
            kCGImageSourceShouldCache: false,
            // Orientation is applied deliberately below, not implicitly here, so the
            // transform is one explicit step rather than two that could compound.
            kCGImageSourceCreateThumbnailWithTransform: false,
        ]

        if maxPixelSize > 0 {
            decodeOptions[kCGImageSourceCreateThumbnailFromImageAlways] = true
            decodeOptions[kCGImageSourceThumbnailMaxPixelSize] = maxPixelSize
            if let downsampled = CGImageSourceCreateThumbnailAtIndex(source, index, decodeOptions as CFDictionary) {
                return downsampled
            }
        }

        guard let full = CGImageSourceCreateImageAtIndex(source, index, decodeOptions as CFDictionary) else {
            throw ConversionError.corrupt("frame \(index)")
        }
        return full
    }

    // MARK: - Transform

    /// Bakes orientation, rotation, flips, scaling, background fill and colour space
    /// into one draw. Doing it in a single context avoids intermediate allocations and
    /// keeps resampling to one pass, which matters for quality as well as memory.
    private static func render(
        _ image: CGImage,
        orientation: Int,
        extraRotation: Int,
        flipHorizontal: Bool,
        flipVertical: Bool,
        targetSize: (width: Int, height: Int),
        flatten: Bool,
        backgroundColor: String,
        convertToSrgb: Bool
    ) throws -> CGImage {
        let quarterTurns = (quarterTurnsForOrientation(orientation) + extraRotation / 90) % 4
        let swapsAxes = quarterTurns % 2 == 1

        let width = swapsAxes ? targetSize.height : targetSize.width
        let height = swapsAxes ? targetSize.width : targetSize.height
        guard width > 0, height > 0 else { throw ConversionError.corrupt("zero-sized output") }

        let colorSpace: CGColorSpace = convertToSrgb
            ? (CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB())
            : (image.colorSpace ?? CGColorSpaceCreateDeviceRGB())

        // A flattened destination gets an opaque context, so there is no alpha channel
        // for a stray transparent pixel to survive in.
        let alphaInfo: CGImageAlphaInfo = flatten ? .noneSkipLast : .premultipliedLast

        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: colorSpace,
            bitmapInfo: alphaInfo.rawValue
        ) else {
            throw ConversionError.outOfMemory
        }

        if flatten {
            let fill = CGColor.fromHex(backgroundColor, colorSpace: colorSpace)
            context.setFillColor(fill)
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }

        context.interpolationQuality = .high

        // Move the origin to the centre so rotation and mirroring are about the middle.
        context.translateBy(x: CGFloat(width) / 2, y: CGFloat(height) / 2)
        if quarterTurns != 0 {
            context.rotate(by: CGFloat(quarterTurns) * .pi / 2)
        }
        if mirrorsForOrientation(orientation) != flipHorizontal {
            context.scaleBy(x: -1, y: 1)
        }
        if flipVertical {
            context.scaleBy(x: 1, y: -1)
        }

        let drawWidth = CGFloat(swapsAxes ? height : width)
        let drawHeight = CGFloat(swapsAxes ? width : height)
        context.draw(
            image,
            in: CGRect(x: -drawWidth / 2, y: -drawHeight / 2, width: drawWidth, height: drawHeight)
        )

        guard let output = context.makeImage() else { throw ConversionError.outOfMemory }
        return output
    }

    /// EXIF orientation 1-8 as clockwise quarter turns.
    private static func quarterTurnsForOrientation(_ orientation: Int) -> Int {
        switch orientation {
        case 3, 4: return 2
        case 5, 8: return 1
        case 6, 7: return 3
        default: return 0
        }
    }

    /// Orientations 2, 4, 5 and 7 are mirrored as well as rotated.
    private static func mirrorsForOrientation(_ orientation: Int) -> Bool {
        orientation == 2 || orientation == 4 || orientation == 5 || orientation == 7
    }

    // MARK: - Sizing

    private static func resolveTargetSize(
        sourceWidth: Int,
        sourceHeight: Int,
        orientation: Int,
        options: Options
    ) -> (width: Int, height: Int) {
        // Orientation is applied later, so sizing reasons in the stored pixel space.
        var width = sourceWidth
        var height = sourceHeight

        switch options.resizeMode {
        case "percent":
            let scale = options.resizePercent / 100
            width = Int((Double(width) * scale).rounded())
            height = Int((Double(height) * scale).rounded())

        case "maxDimension":
            let maxW = options.maxWidth > 0 ? Double(options.maxWidth) : .greatestFiniteMagnitude
            let maxH = options.maxHeight > 0 ? Double(options.maxHeight) : .greatestFiniteMagnitude
            let scale = min(maxW / Double(width), maxH / Double(height))
            if scale < 1 || options.allowUpscale {
                width = Int((Double(width) * scale).rounded())
                height = Int((Double(height) * scale).rounded())
            }

        case "exact":
            width = options.exactWidth
            height = options.exactHeight

        default:
            break
        }

        if !options.allowUpscale && options.resizeMode != "exact" {
            width = min(width, sourceWidth)
            height = min(height, sourceHeight)
        }
        return (max(width, 1), max(height, 1))
    }

    // MARK: - Metadata

    /// Applies the metadata policy and always resets orientation, because the rotation
    /// is now in the pixels — leaving the tag would rotate the image a second time.
    private static func metadataDictionary(
        from properties: [CFString: Any],
        options: Options
    ) -> [CFString: Any] {
        var metadata: [CFString: Any] = [:]

        if options.metadataMode != "stripAll" {
            metadata = properties
            metadata.removeValue(forKey: kCGImagePropertyPixelWidth)
            metadata.removeValue(forKey: kCGImagePropertyPixelHeight)

            if options.metadataMode == "keepExceptGps" {
                metadata.removeValue(forKey: kCGImagePropertyGPSDictionary)
                if var exif = metadata[kCGImagePropertyExifDictionary] as? [CFString: Any] {
                    // Some cameras duplicate a coarse location here.
                    exif.removeValue(forKey: kCGImagePropertyExifSubjectLocation)
                    metadata[kCGImagePropertyExifDictionary] = exif
                }
            }
        }

        metadata[kCGImagePropertyOrientation] = 1
        return metadata
    }

    // MARK: - Encode

    private static func encodeAtomically(
        image: CGImage,
        to outputURL: URL,
        type: UTType,
        metadata: [CFString: Any],
        options: Options
    ) throws -> Int {
        let temporaryURL = outputURL.deletingLastPathComponent()
            .appendingPathComponent(".\(UUID().uuidString).partial")

        defer { try? FileManager.default.removeItem(at: temporaryURL) }

        let quality = try writeSearchingForQuality(
            image: image,
            to: temporaryURL,
            type: type,
            metadata: metadata,
            options: options
        )

        // The move is the commit point: until it succeeds, `outputURL` does not exist,
        // so a crash cannot leave a truncated file where a finished one should be.
        try? FileManager.default.removeItem(at: outputURL)
        try FileManager.default.moveItem(at: temporaryURL, to: outputURL)
        return quality
    }

    /// Encodes once at the requested quality, or binary-searches when a target size is
    /// set. The search is bounded to eight probes: past that the byte-size gain is
    /// below what a user would notice and the wait is not.
    private static func writeSearchingForQuality(
        image: CGImage,
        to url: URL,
        type: UTType,
        metadata: [CFString: Any],
        options: Options
    ) throws -> Int {
        guard options.targetByteSize > 0, isLossy(options.targetFormat) else {
            try write(image: image, to: url, type: type, metadata: metadata, quality: options.quality, lossless: options.lossless)
            return options.quality
        }

        var low = 1
        var high = 100
        var bestQuality: Int?

        for _ in 0..<8 where low <= high {
            let mid = (low + high) / 2
            try write(image: image, to: url, type: type, metadata: metadata, quality: mid, lossless: false)
            let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)??.intValue ?? .max

            if size <= options.targetByteSize {
                bestQuality = mid
                low = mid + 1
            } else {
                high = mid - 1
            }
        }

        // Re-encode at the best quality found, since the last probe may have overshot.
        let quality = bestQuality ?? 1
        try write(image: image, to: url, type: type, metadata: metadata, quality: quality, lossless: false)
        return quality
    }

    private static func write(
        image: CGImage,
        to url: URL,
        type: UTType,
        metadata: [CFString: Any],
        quality: Int,
        lossless: Bool
    ) throws {
        guard let destination = CGImageDestinationCreateWithURL(
            url as CFURL, type.identifier as CFString, 1, nil
        ) else {
            throw ConversionError.unsupportedTarget(type.identifier)
        }

        var properties = metadata
        properties[kCGImageDestinationLossyCompressionQuality] = lossless ? 1.0 : Double(quality) / 100

        CGImageDestinationAddImage(destination, image, properties as CFDictionary)
        guard CGImageDestinationFinalize(destination) else {
            throw ConversionError.diskFull
        }
    }

    // MARK: - Paths and space

    private static func resolveOutputURL(requested: URL?, inputURL: URL, format: String) throws -> URL {
        if let requested { return requested }

        let directory = try managedOutputDirectory()
        let base = inputURL.deletingPathExtension().lastPathComponent
        let ext = FormatTable.spec(format)?.extensions.first ?? format
        var candidate = directory.appendingPathComponent("\(base).\(ext)")

        // Never silently overwrite: suffix until the name is free.
        var suffix = 1
        while FileManager.default.fileExists(atPath: candidate.path) {
            candidate = directory.appendingPathComponent("\(base) (\(suffix)).\(ext)")
            suffix += 1
        }
        return candidate
    }

    public static func managedOutputDirectory() throws -> URL {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        let directory = base.appendingPathComponent("ConvertedFiles", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    /// Checked before encoding, so a full disk produces a clear message rather than a
    /// half-written file and an opaque failure.
    private static func ensureSpaceAvailable(for url: URL, estimatedBytes: Int64) throws {
        let values = try? url.deletingLastPathComponent()
            .resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        guard let available = values?.volumeAvailableCapacityForImportantUsage else { return }
        if available < estimatedBytes {
            throw ConversionError.diskFull
        }
    }

    // MARK: - Format helpers

    private static func utType(for formatId: String) -> UTType? {
        switch formatId {
        case "jpeg": return .jpeg
        case "png": return .png
        case "gif": return .gif
        case "bmp": return .bmp
        case "tiff": return .tiff
        case "heic": return .heic
        case "heif": return .heif
        case "webp": return UTType("org.webmproject.webp")
        case "avif": return UTType("public.avif")
        case "ico": return UTType("com.microsoft.ico")
        default: return nil
        }
    }

    private static func formatSupportsAlpha(_ formatId: String) -> Bool {
        FormatTable.spec(formatId)?.supportsAlpha ?? false
    }

    private static func isLossy(_ formatId: String) -> Bool {
        formatId == "jpeg" || formatId == "webp" || formatId == "avif" || formatId == "heic"
    }
}

// MARK: - Colour parsing

extension CGColor {
    /// Parses `#RRGGBB`. Falls back to white, which is the safe default when flattening
    /// transparency — a wrong-but-white background is recoverable, a black one is the
    /// complaint this whole path exists to avoid.
    static func fromHex(_ hex: String, colorSpace: CGColorSpace) -> CGColor {
        let cleaned = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard cleaned.count == 6, let value = UInt32(cleaned, radix: 16) else {
            return CGColor(colorSpace: colorSpace, components: [1, 1, 1, 1]) ?? CGColor(gray: 1, alpha: 1)
        }
        let red = CGFloat((value >> 16) & 0xFF) / 255
        let green = CGFloat((value >> 8) & 0xFF) / 255
        let blue = CGFloat(value & 0xFF) / 255
        return CGColor(colorSpace: colorSpace, components: [red, green, blue, 1])
            ?? CGColor(gray: 1, alpha: 1)
    }
}
