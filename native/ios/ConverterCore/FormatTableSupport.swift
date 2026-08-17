// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import Foundation

/// Matching logic for the generated format table.
///
/// The table itself is data compiled from `src/engine/formats.ts`; only this matching
/// behaviour is written by hand, and it is deliberately trivial so there is very little
/// room for it to disagree with the TypeScript reference implementation.
extension FormatTable {

    public static func spec(_ formatId: String) -> Spec? { specs[formatId] }

    /// True when any of the format's signatures matches the prefix.
    public static func matches(_ bytes: [UInt8], formatId: String) -> Bool {
        guard let spec = specs[formatId] else { return false }
        return spec.signatures.contains { matches(bytes, signature: $0) }
    }

    /// The note attached to whichever signature matched, for the detection reason.
    public static func note(_ bytes: [UInt8], formatId: String) -> String {
        guard let spec = specs[formatId] else { return "" }
        if let matched = spec.signatures.first(where: { matches(bytes, signature: $0) }) {
            return matched.note
        }
        return "\(spec.label) signature matched"
    }

    private static func matches(_ bytes: [UInt8], signature: Signature) -> Bool {
        signature.clauses.allSatisfy { clause in
            guard clause.offset >= 0, clause.offset + clause.bytes.count <= bytes.count else {
                return false
            }
            for (index, expected) in clause.bytes.enumerated()
            where bytes[clause.offset + index] != expected {
                return false
            }
            return true
        }
    }

    /// What a filename claims. Used only to report a mismatch, never to decide.
    public static func formatId(forFilename filename: String) -> String? {
        let ext = (filename as NSString).pathExtension.lowercased()
        guard !ext.isEmpty else { return nil }
        return allFormatIds.first { specs[$0]?.extensions.contains(ext) == true }
    }

    /// Every UTI the app registers as an "Open with" handler for.
    public static var allUTIs: [String] {
        allFormatIds.compactMap { specs[$0]?.uti }
    }
}
