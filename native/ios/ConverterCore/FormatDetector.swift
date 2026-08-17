// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Identifies files from their bytes and reads their header metadata.
///
/// Two rules hold throughout:
///
///   1. The extension is never trusted. A `.png` that is really a HEIC is a real case,
///      and a converter that believes the name produces an output byte-identical to its
///      input. Everything here is decided from the bytes.
///   2. Nothing is decoded. `CGImageSourceCopyPropertiesAtIndex` reads headers only, so
///      a 200-megapixel file costs the same as a thumbnail.
///
/// This mirrors `src/engine/detect.ts`, and `ConverterCoreTests` runs the shared fixture
/// corpus through both so a divergence fails CI rather than shipping.
public enum FormatDetector {

    /// Enough for every fixed signature, both TIFF byte orders, and the SVG prefix scan.
    public static let sniffByteCount = 4096

    // MARK: - Public API

    public static func detect(url: URL) throws -> DetectedFile {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }

        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        let byteSize = (attributes[.size] as? NSNumber)?.int64Value ?? 0

        let prefix = try handle.read(upToCount: sniffByteCount) ?? Data()
        var detection = identify(prefix: prefix, filename: url.lastPathComponent)
        detection.uri = url.absoluteString
        detection.byteSize = byteSize

        if byteSize == 0 {
            detection.format = ""
            detection.confidence = "none"
            detection.reason = "The file is empty (zero bytes)."
            return detection
        }

        readHeaderMetadata(url: url, into: &detection)
        return detection
    }

    public static func detect(data: Data, filename: String) -> DetectedFile {
        var detection = identify(prefix: data.prefix(sniffByteCount), filename: filename)
        detection.byteSize = Int64(data.count)
        if data.isEmpty {
            detection.format = ""
            detection.confidence = "none"
            detection.reason = "The file is empty (zero bytes)."
        }
        return detection
    }

    // MARK: - Signature matching

    private static func identify(prefix: Data, filename: String) -> DetectedFile {
        let claimed = FormatTable.formatId(forFilename: filename) ?? ""
        let bytes = [UInt8](prefix)

        var result = DetectedFile(uri: "", displayName: filename)
        result.claimedFormat = claimed

        guard !bytes.isEmpty else {
            result.reason = "The file is empty (zero bytes)."
            return result
        }

        for id in FormatTable.detectionOrder {
            switch id {
            case "svg":
                if looksLikeSVG(bytes) {
                    return settle(&result, "svg", "deep", "XML prefix containing an <svg> element")
                }

            case "tiff":
                // Reached only when no more specific TIFF-family signature matched, so
                // this is where DNG, NEF and ARW get separated from a genuine TIFF.
                if FormatTable.matches(bytes, formatId: "tiff") {
                    let resolved = resolveTIFFFamily(bytes)
                    return settle(&result, resolved.format, "deep", resolved.reason)
                }

            case "dng", "nef", "arw":
                // Share the bare TIFF signature; resolved by resolveTIFFFamily above.
                continue

            default:
                if FormatTable.matches(bytes, formatId: id) {
                    let note = FormatTable.note(bytes, formatId: id)
                    return settle(&result, id, "signature", note)
                }
            }
        }

        // Readers tolerate leading junk before %PDF-, so a strict offset-0 test misses
        // files written by sloppy producers.
        if let offset = indexOf(pattern: Array("%PDF-".utf8), in: bytes, limit: 1024), offset > 0 {
            return settle(&result, "pdf", "deep", "PDF header found at offset \(offset) after leading junk")
        }

        result.reason = "No known signature matched the first bytes of this file. It may be "
            + "corrupt, truncated, or a format this app does not support."
        return result
    }

    private static func settle(
        _ result: inout DetectedFile,
        _ format: String,
        _ confidence: String,
        _ reason: String
    ) -> DetectedFile {
        result.format = format
        result.confidence = confidence
        result.reason = reason
        return result
    }

    // MARK: - TIFF family

    private static let tagMake: UInt16 = 0x010F
    private static let tagDNGVersion: UInt16 = 0xC612

    /// Walks IFD0 far enough to tell the TIFF-based RAW formats apart. Deliberately
    /// bounded: no sub-IFDs are followed, so a malicious or truncated file costs nothing.
    private static func resolveTIFFFamily(_ bytes: [UInt8]) -> (format: String, reason: String) {
        guard bytes.count >= 8 else {
            return ("tiff", "TIFF header; too little data to inspect IFD0")
        }

        let littleEndian = bytes[0] == 0x49 && bytes[1] == 0x49

        func u16(_ offset: Int) -> UInt16? {
            guard offset + 1 < bytes.count else { return nil }
            return littleEndian
                ? UInt16(bytes[offset]) | (UInt16(bytes[offset + 1]) << 8)
                : (UInt16(bytes[offset]) << 8) | UInt16(bytes[offset + 1])
        }

        func u32(_ offset: Int) -> UInt32? {
            guard offset + 3 < bytes.count else { return nil }
            let b = bytes
            return littleEndian
                ? UInt32(b[offset]) | (UInt32(b[offset + 1]) << 8)
                    | (UInt32(b[offset + 2]) << 16) | (UInt32(b[offset + 3]) << 24)
                : (UInt32(b[offset]) << 24) | (UInt32(b[offset + 1]) << 16)
                    | (UInt32(b[offset + 2]) << 8) | UInt32(b[offset + 3])
        }

        guard u16(2) == 42, let ifd0 = u32(4).map(Int.init), let count = u16(ifd0) else {
            return ("tiff", "TIFF header; IFD0 unreadable, treating as a plain TIFF")
        }
        // A plausible IFD0 has tens of entries, not thousands.
        guard count > 0, count <= 512 else {
            return ("tiff", "TIFF header; IFD0 entry count implausible, treating as a plain TIFF")
        }

        var hasDNGVersion = false
        var make: String?

        for index in 0..<Int(count) {
            let entry = ifd0 + 2 + index * 12
            guard entry + 12 <= bytes.count, let tag = u16(entry) else { break }

            if tag == tagDNGVersion {
                hasDNGVersion = true
                continue
            }
            guard tag == tagMake, let valueCount = u32(entry + 4).map(Int.init) else { continue }

            // ASCII values of four bytes or fewer are stored inline.
            let valueOffset = valueCount <= 4 ? entry + 8 : (u32(entry + 8).map(Int.init) ?? 0)
            guard valueOffset > 0, valueOffset < bytes.count else { continue }

            let end = min(valueOffset + valueCount, bytes.count)
            let slice = bytes[valueOffset..<end].prefix { $0 != 0 }
            make = String(decoding: slice, as: UTF8.self).trimmingCharacters(in: .whitespaces)
        }

        if hasDNGVersion {
            return ("dng", "TIFF container carrying the DNGVersion tag (50706)")
        }

        let upper = make?.uppercased() ?? ""
        // A Nikon-branded DNG is still a DNG, which is why the tag is checked first.
        if upper.contains("NIKON") { return ("nef", "TIFF container, EXIF Make \"\(make ?? "")\"") }
        if upper.contains("SONY") { return ("arw", "TIFF container, EXIF Make \"\(make ?? "")\"") }
        if upper.contains("OLYMPUS") { return ("orf", "TIFF container, EXIF Make \"\(make ?? "")\"") }
        if upper.contains("CANON") { return ("cr2", "TIFF container, EXIF Make \"\(make ?? "")\"") }

        return ("tiff", "TIFF container with no RAW marker in IFD0")
    }

    // MARK: - Text sniffing

    private static func looksLikeSVG(_ bytes: [UInt8]) -> Bool {
        // Any NUL in the prefix means binary, not XML.
        if bytes.contains(0) { return false }
        let text = String(decoding: bytes.prefix(sniffByteCount), as: UTF8.self)
        return text.range(of: "<svg[\\s>]", options: [.regularExpression, .caseInsensitive]) != nil
    }

    private static func indexOf(pattern: [UInt8], in bytes: [UInt8], limit: Int) -> Int? {
        let end = min(bytes.count, limit) - pattern.count
        guard end >= 0 else { return nil }
        for start in 0...end where Array(bytes[start..<(start + pattern.count)]) == pattern {
            return start
        }
        return nil
    }

    // MARK: - Header metadata

    /// Reads dimensions, orientation, colour space and metadata flags without decoding.
    private static func readHeaderMetadata(url: URL, into detection: inout DetectedFile) {
        let options: [CFString: Any] = [kCGImageSourceShouldCache: false]
        guard let source = CGImageSourceCreateWithURL(url as CFURL, options as CFDictionary) else {
            return
        }

        detection.frameCount = CGImageSourceGetCount(source)
        detection.isAnimated = detection.frameCount > 1

        guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, options as CFDictionary)
            as? [CFString: Any]
        else { return }

        detection.pixelWidth = (properties[kCGImagePropertyPixelWidth] as? Int) ?? 0
        detection.pixelHeight = (properties[kCGImagePropertyPixelHeight] as? Int) ?? 0
        detection.bitDepth = (properties[kCGImagePropertyDepth] as? Int) ?? 8
        detection.hasAlpha = (properties[kCGImagePropertyHasAlpha] as? Bool) ?? false
        detection.exifOrientation = (properties[kCGImagePropertyOrientation] as? Int) ?? 0
        detection.hasGpsMetadata = properties[kCGImagePropertyGPSDictionary] != nil

        // The colour space matters twice over: Display P3 needs converting to sRGB or
        // the output looks over-saturated in apps that ignore the profile, and CMYK is
        // the case that comes out inverted when a decoder assumes RGB. Recording it
        // here lets the codec branch instead of guessing.
        if let profile = properties[kCGImagePropertyProfileName] as? String {
            detection.colorSpace = profile
        } else if properties[kCGImagePropertyIsIndexed] as? Bool == true {
            detection.colorSpace = "Indexed"
        }
    }
}
