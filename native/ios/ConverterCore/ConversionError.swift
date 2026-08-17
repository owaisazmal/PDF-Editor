// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import Foundation

/// Failures that a user can be told about.
///
/// Each case carries a stable machine code matching `ConversionErrorCode` in
/// `src/native/types.ts`. The UI resolves a localised string from the code and never
/// shows `debugDescription` — that is for the console and for bug reports.
///
/// One file failing must never end a batch, so these are thrown per file and collected
/// rather than propagated out of the queue.
public enum ConversionError: LocalizedError, Sendable {
    case unreadable(String)
    case unsupportedSource(String)
    case unsupportedTarget(String)
    case corrupt(String)
    case outOfMemory
    case diskFull
    case permissionDenied
    case passwordRequired
    case wrongPassword
    case downloadFailed(String)
    case cancelled

    /// The stable identifier sent across the bridge.
    public var code: String {
        switch self {
        case .unreadable: return "unreadable"
        case .unsupportedSource: return "unsupportedSource"
        case .unsupportedTarget: return "unsupportedTarget"
        case .corrupt: return "corrupt"
        case .outOfMemory: return "outOfMemory"
        case .diskFull: return "diskFull"
        case .permissionDenied: return "permissionDenied"
        case .passwordRequired: return "passwordRequired"
        case .wrongPassword: return "wrongPassword"
        case .downloadFailed: return "downloadFailed"
        case .cancelled: return "cancelled"
        }
    }

    public var errorDescription: String? {
        switch self {
        case .unreadable(let name): return "Could not open \(name)."
        case .unsupportedSource(let format): return "Cannot read \(format) on this device."
        case .unsupportedTarget(let format): return "Cannot write \(format) on this device."
        case .corrupt(let name): return "\(name) is damaged or incomplete."
        case .outOfMemory: return "Not enough memory to process this image."
        case .diskFull: return "Not enough free space to write the result."
        case .permissionDenied: return "Permission to save was denied."
        case .passwordRequired: return "This document is password protected."
        case .wrongPassword: return "The password was not accepted."
        case .downloadFailed(let name): return "Could not download \(name) from the cloud."
        case .cancelled: return "Cancelled."
        }
    }
}
