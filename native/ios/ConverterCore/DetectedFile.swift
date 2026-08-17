// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import Foundation

/// What the detector knows about a file after reading its header.
///
/// The field names and types match `DetectedFileSpec` in
/// `src/native/NativeFormatDetector.ts` exactly, because `dictionaryRepresentation`
/// is what crosses the bridge. `__tests__/native/spec-parity.test.ts` fails if the
/// two ever diverge.
public struct DetectedFile: Sendable {
    public var uri: String
    public var displayName: String

    /// A format id from the generated table, or "" when unidentified. An empty format
    /// is not an error — the batch continues past it and reports that one file.
    public var format: String = ""
    public var confidence: String = "none"
    public var reason: String = ""
    public var claimedFormat: String = ""

    public var byteSize: Int64 = 0
    public var pixelWidth: Int = 0
    public var pixelHeight: Int = 0

    /// EXIF orientation, 1-8. Zero when absent.
    public var exifOrientation: Int = 0
    public var hasAlpha: Bool = false
    public var isAnimated: Bool = false
    public var frameCount: Int = 1
    public var colorSpace: String = ""
    public var bitDepth: Int = 8
    public var hasGpsMetadata: Bool = false

    public var pageCount: Int = 0
    public var isEncrypted: Bool = false
    public var needsDownload: Bool = false

    public init(uri: String, displayName: String) {
        self.uri = uri
        self.displayName = displayName
    }

    /// The bridge payload. Every value is a JSON primitive; nothing here is lossy.
    public var dictionaryRepresentation: [String: Any] {
        [
            "uri": uri,
            "displayName": displayName,
            "format": format,
            "confidence": confidence,
            "reason": reason,
            "claimedFormat": claimedFormat,
            // Int64 is bridged as a Double; JavaScript's safe integer range covers
            // file sizes far beyond anything a phone can hold, so this is exact.
            "byteSize": Double(byteSize),
            "pixelWidth": pixelWidth,
            "pixelHeight": pixelHeight,
            "exifOrientation": exifOrientation,
            "hasAlpha": hasAlpha,
            "isAnimated": isAnimated,
            "frameCount": frameCount,
            "colorSpace": colorSpace,
            "bitDepth": bitDepth,
            "hasGpsMetadata": hasGpsMetadata,
            "pageCount": pageCount,
            "isEncrypted": isEncrypted,
            "needsDownload": needsDownload,
        ]
    }
}
