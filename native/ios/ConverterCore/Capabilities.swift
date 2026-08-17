// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import Foundation
import ImageIO
import UniformTypeIdentifiers

/// What this device can actually read and write.
///
/// Asked of the system rather than hardcoded against OS versions. Version checks age
/// badly and get copied wrong; `CGImageSourceCopyTypeIdentifiers` is the truth, and it
/// stays correct on a future OS that gains a codec without us shipping an update.
///
/// The engine builds its conversion matrix from this at startup, so a format the device
/// cannot handle is disabled in the UI instead of failing at the end of a batch.
public enum Capabilities {

    public struct Report: Sendable {
        public let decode: [String]
        public let encode: [String]

        public var dictionaryRepresentation: [String: Any] {
            ["decode": decode, "encode": encode]
        }
    }

    public static func current() -> Report {
        let readable = Set((CGImageSourceCopyTypeIdentifiers() as? [String] ?? []).map { $0.lowercased() })
        let writable = Set((CGImageDestinationCopyTypeIdentifiers() as? [String] ?? []).map { $0.lowercased() })

        var decode: [String] = []
        var encode: [String] = []

        for formatId in FormatTable.allFormatIds {
            guard let spec = FormatTable.spec(formatId) else { continue }

            // PDF is handled by PDFKit rather than ImageIO, so it is asserted directly.
            if spec.kind == "document" {
                decode.append(formatId)
                encode.append(formatId)
                continue
            }
            // SVG has no ImageIO rasteriser on any iOS version; it is rendered through
            // react-native-svg instead. Declared as import-only.
            if spec.kind == "vector" {
                decode.append(formatId)
                continue
            }

            let identifiers = utTypeIdentifiers(for: spec)
            if identifiers.contains(where: { readable.contains($0) }) {
                decode.append(formatId)
            }
            if !spec.importOnly, identifiers.contains(where: { writable.contains($0) }) {
                encode.append(formatId)
            }
        }

        return Report(decode: decode.sorted(), encode: encode.sorted())
    }

    /// Every UTI that could stand for this format. ImageIO reports the concrete system
    /// identifiers, which do not always match the one in our table exactly — RAW types
    /// in particular are vendor-specific.
    private static func utTypeIdentifiers(for spec: FormatTable.Spec) -> [String] {
        var identifiers: Set<String> = [spec.uti.lowercased()]

        for mimeType in spec.mimeTypes {
            for type in UTType.types(tag: mimeType, tagClass: .mimeType, conformingTo: nil) {
                identifiers.insert(type.identifier.lowercased())
            }
        }
        for ext in spec.extensions {
            for type in UTType.types(tag: ext, tagClass: .filenameExtension, conformingTo: nil) {
                identifiers.insert(type.identifier.lowercased())
            }
        }
        return Array(identifiers)
    }
}
