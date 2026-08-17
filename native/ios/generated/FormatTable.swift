// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0
//
// GENERATED FILE — DO NOT EDIT.
// Source: src/engine/formats.ts   Regenerate: npm run formats:gen

import Foundation

/// The format table, compiled from the TypeScript source of truth.
/// Matching logic lives in FormatTableSupport.swift; this file is data only.
public enum FormatTable {

    public struct Clause: Sendable {
        public let offset: Int
        public let bytes: [UInt8]
    }

    public struct Signature: Sendable {
        public let clauses: [Clause]
        public let note: String
    }

    public struct Spec: Sendable {
        public let id: String
        public let label: String
        public let kind: String
        public let extensions: [String]
        public let mimeTypes: [String]
        public let uti: String
        public let importOnly: Bool
        public let supportsAlpha: Bool
        public let signatures: [Signature]
    }

    /// Order matters: formats whose signatures are subsets of another's are tested
    /// first, or the looser pattern wins.
    public static let detectionOrder: [String] = [
        "jpeg",
        "png",
        "gif",
        "webp",
        "bmp",
        "ico",
        "raf",
        "orf",
        "pdf",
        "cr3",
        "avif",
        "heic",
        "heif",
        "cr2",
        "dng",
        "nef",
        "arw",
        "tiff",
        "svg"
    ]

    public static let allFormatIds: [String] = [
        "jpeg",
        "png",
        "gif",
        "bmp",
        "webp",
        "tiff",
        "ico",
        "heic",
        "heif",
        "avif",
        "svg",
        "pdf",
        "dng",
        "cr2",
        "cr3",
        "nef",
        "arw",
        "raf",
        "orf"
    ]

    public static let specs: [String: Spec] = [
    "jpeg": Spec(
      id: "jpeg",
      label: "JPEG",
      kind: "raster",
      extensions: ["jpg", "jpeg", "jpe", "jfif"],
      mimeTypes: ["image/jpeg"],
      uti: "public.jpeg",
      importOnly: false,
      supportsAlpha: false,
      signatures: [
      Signature(clauses: [Clause(offset: 0, bytes: [0xFF, 0xD8, 0xFF])], note: "SOI marker")
      ]
    ),
    "png": Spec(
      id: "png",
      label: "PNG",
      kind: "raster",
      extensions: ["png"],
      mimeTypes: ["image/png"],
      uti: "public.png",
      importOnly: false,
      supportsAlpha: true,
      signatures: [
      Signature(clauses: [Clause(offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])], note: "PNG signature; APNG is a PNG with an acTL chunk")
      ]
    ),
    "gif": Spec(
      id: "gif",
      label: "GIF",
      kind: "raster",
      extensions: ["gif"],
      mimeTypes: ["image/gif"],
      uti: "com.compuserve.gif",
      importOnly: false,
      supportsAlpha: true,
      signatures: [
      Signature(clauses: [Clause(offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])], note: "GIF signature matched"),
      Signature(clauses: [Clause(offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])], note: "GIF signature matched")
      ]
    ),
    "bmp": Spec(
      id: "bmp",
      label: "BMP",
      kind: "raster",
      extensions: ["bmp", "dib"],
      mimeTypes: ["image/bmp"],
      uti: "com.microsoft.bmp",
      importOnly: false,
      supportsAlpha: true,
      signatures: [
      Signature(clauses: [Clause(offset: 0, bytes: [0x42, 0x4D])], note: "BMP signature matched")
      ]
    ),
    "webp": Spec(
      id: "webp",
      label: "WebP",
      kind: "raster",
      extensions: ["webp"],
      mimeTypes: ["image/webp"],
      uti: "org.webmproject.webp",
      importOnly: false,
      supportsAlpha: true,
      signatures: [
      Signature(clauses: [Clause(offset: 0, bytes: [0x52, 0x49, 0x46, 0x46]), Clause(offset: 8, bytes: [0x57, 0x45, 0x42, 0x50])], note: "RIFF container with a WEBP form type; the VP8/VP8L/VP8X chunk follows")
      ]
    ),
    "tiff": Spec(
      id: "tiff",
      label: "TIFF",
      kind: "raster",
      extensions: ["tif", "tiff"],
      mimeTypes: ["image/tiff"],
      uti: "public.tiff",
      importOnly: false,
      supportsAlpha: true,
      signatures: [
      Signature(clauses: [Clause(offset: 0, bytes: [0x49, 0x49, 0x2A, 0x00])], note: "little-endian TIFF"),
      Signature(clauses: [Clause(offset: 0, bytes: [0x4D, 0x4D, 0x00, 0x2A])], note: "big-endian TIFF")
      ]
    ),
    "ico": Spec(
      id: "ico",
      label: "ICO",
      kind: "raster",
      extensions: ["ico"],
      mimeTypes: ["image/x-icon", "image/vnd.microsoft.icon"],
      uti: "com.microsoft.ico",
      importOnly: false,
      supportsAlpha: true,
      signatures: [
      Signature(clauses: [Clause(offset: 0, bytes: [0x00, 0x00, 0x01, 0x00])], note: "ICO signature matched")
      ]
    ),
    "heic": Spec(
      id: "heic",
      label: "HEIC",
      kind: "raster",
      extensions: ["heic", "heics"],
      mimeTypes: ["image/heic", "image/heic-sequence"],
      uti: "public.heic",
      importOnly: false,
      supportsAlpha: true,
      signatures: [
      Signature(clauses: [Clause(offset: 4, bytes: [0x66, 0x74, 0x79, 0x70]), Clause(offset: 8, bytes: [0x68, 0x65, 0x69, 0x63])], note: "ISO base media file format, major or compatible brand \"heic\""),
      Signature(clauses: [Clause(offset: 4, bytes: [0x66, 0x74, 0x79, 0x70]), Clause(offset: 8, bytes: [0x68, 0x65, 0x69, 0x78])], note: "ISO base media file format, major or compatible brand \"heix\""),
      Signature(clauses: [Clause(offset: 4, bytes: [0x66, 0x74, 0x79, 0x70]), Clause(offset: 8, bytes: [0x68, 0x65, 0x76, 0x63])], note: "ISO base media file format, major or compatible brand \"hevc\""),
      Signature(clauses: [Clause(offset: 4, bytes: [0x66, 0x74, 0x79, 0x70]), Clause(offset: 8, bytes: [0x68, 0x65, 0x76, 0x78])], note: "ISO base media file format, major or compatible brand \"hevx\""),
      Signature(clauses: [Clause(offset: 4, bytes: [0x66, 0x74, 0x79, 0x70]), Clause(offset: 8, bytes: [0x68, 0x65, 0x69, 0x6D])], note: "ISO base media file format, major or compatible brand \"heim\""),
      Signature(clauses: [Clause(offset: 4, bytes: [0x66, 0x74, 0x79, 0x70]), Clause(offset: 8, bytes: [0x68, 0x65, 0x69, 0x73])], note: "ISO base media file format, major or compatible brand \"heis\""),
      Signature(clauses: [Clause(offset: 4, bytes: [0x66, 0x74, 0x79, 0x70]), Clause(offset: 8, bytes: [0x68, 0x65, 0x76, 0x6D])], note: "ISO base media file format, major or compatible brand \"hevm\""),
      Signature(clauses: [Clause(offset: 4, bytes: [0x66, 0x74, 0x79, 0x70]), Clause(offset: 8, bytes: [0x68, 0x65, 0x76, 0x73])], note: "ISO base media file format, major or compatible brand \"hevs\"")
      ]
    ),
    "heif": Spec(
      id: "heif",
      label: "HEIF",
      kind: "raster",
      extensions: ["heif", "hif"],
      mimeTypes: ["image/heif", "image/heif-sequence"],
      uti: "public.heif",
      importOnly: false,
      supportsAlpha: true,
      signatures: [
      Signature(clauses: [Clause(offset: 4, bytes: [0x66, 0x74, 0x79, 0x70]), Clause(offset: 8, bytes: [0x6D, 0x69, 0x66, 0x31])], note: "ISO base media file format, major or compatible brand \"mif1\""),
      Signature(clauses: [Clause(offset: 4, bytes: [0x66, 0x74, 0x79, 0x70]), Clause(offset: 8, bytes: [0x6D, 0x73, 0x66, 0x31])], note: "ISO base media file format, major or compatible brand \"msf1\"")
      ]
    ),
    "avif": Spec(
      id: "avif",
      label: "AVIF",
      kind: "raster",
      extensions: ["avif", "avifs"],
      mimeTypes: ["image/avif", "image/avif-sequence"],
      uti: "public.avif",
      importOnly: false,
      supportsAlpha: true,
      signatures: [
      Signature(clauses: [Clause(offset: 4, bytes: [0x66, 0x74, 0x79, 0x70]), Clause(offset: 8, bytes: [0x61, 0x76, 0x69, 0x66])], note: "ISO base media file format, major or compatible brand \"avif\""),
      Signature(clauses: [Clause(offset: 4, bytes: [0x66, 0x74, 0x79, 0x70]), Clause(offset: 8, bytes: [0x61, 0x76, 0x69, 0x73])], note: "ISO base media file format, major or compatible brand \"avis\"")
      ]
    ),
    "svg": Spec(
      id: "svg",
      label: "SVG",
      kind: "vector",
      extensions: ["svg"],
      mimeTypes: ["image/svg+xml"],
      uti: "public.svg-image",
      importOnly: true,
      supportsAlpha: true,
      signatures: [
        
      ]
    ),
    "pdf": Spec(
      id: "pdf",
      label: "PDF",
      kind: "document",
      extensions: ["pdf"],
      mimeTypes: ["application/pdf"],
      uti: "com.adobe.pdf",
      importOnly: false,
      supportsAlpha: false,
      signatures: [
      Signature(clauses: [Clause(offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2D])], note: "Readers tolerate leading junk, so a prefix scan is also performed")
      ]
    ),
    "dng": Spec(
      id: "dng",
      label: "Adobe DNG",
      kind: "raw",
      extensions: ["dng"],
      mimeTypes: ["image/x-adobe-dng"],
      uti: "com.adobe.raw-image",
      importOnly: true,
      supportsAlpha: false,
      signatures: [
      Signature(clauses: [Clause(offset: 0, bytes: [0x49, 0x49, 0x2A, 0x00])], note: "Adobe DNG signature matched"),
      Signature(clauses: [Clause(offset: 0, bytes: [0x4D, 0x4D, 0x00, 0x2A])], note: "Adobe DNG signature matched")
      ]
    ),
    "cr2": Spec(
      id: "cr2",
      label: "Canon CR2",
      kind: "raw",
      extensions: ["cr2"],
      mimeTypes: ["image/x-canon-cr2"],
      uti: "com.canon.cr2-raw-image",
      importOnly: true,
      supportsAlpha: false,
      signatures: [
      Signature(clauses: [Clause(offset: 0, bytes: [0x49, 0x49, 0x2A, 0x00]), Clause(offset: 8, bytes: [0x43, 0x52])], note: "TIFF header with the Canon CR2 marker at offset 8")
      ]
    ),
    "cr3": Spec(
      id: "cr3",
      label: "Canon CR3",
      kind: "raw",
      extensions: ["cr3"],
      mimeTypes: ["image/x-canon-cr3"],
      uti: "com.canon.cr3-raw-image",
      importOnly: true,
      supportsAlpha: false,
      signatures: [
      Signature(clauses: [Clause(offset: 4, bytes: [0x66, 0x74, 0x79, 0x70]), Clause(offset: 8, bytes: [0x63, 0x72, 0x78, 0x20])], note: "ISO base media file format, major or compatible brand \"crx \"")
      ]
    ),
    "nef": Spec(
      id: "nef",
      label: "Nikon NEF",
      kind: "raw",
      extensions: ["nef", "nrw"],
      mimeTypes: ["image/x-nikon-nef"],
      uti: "com.nikon.raw-image",
      importOnly: true,
      supportsAlpha: false,
      signatures: [
      Signature(clauses: [Clause(offset: 0, bytes: [0x4D, 0x4D, 0x00, 0x2A])], note: "Nikon NEF signature matched"),
      Signature(clauses: [Clause(offset: 0, bytes: [0x49, 0x49, 0x2A, 0x00])], note: "Nikon NEF signature matched")
      ]
    ),
    "arw": Spec(
      id: "arw",
      label: "Sony ARW",
      kind: "raw",
      extensions: ["arw", "sr2", "srf"],
      mimeTypes: ["image/x-sony-arw"],
      uti: "com.sony.raw-image",
      importOnly: true,
      supportsAlpha: false,
      signatures: [
      Signature(clauses: [Clause(offset: 0, bytes: [0x49, 0x49, 0x2A, 0x00])], note: "Sony ARW signature matched")
      ]
    ),
    "raf": Spec(
      id: "raf",
      label: "Fujifilm RAF",
      kind: "raw",
      extensions: ["raf"],
      mimeTypes: ["image/x-fuji-raf"],
      uti: "com.fuji.raw-image",
      importOnly: true,
      supportsAlpha: false,
      signatures: [
      Signature(clauses: [Clause(offset: 0, bytes: [0x46, 0x55, 0x4A, 0x49, 0x46, 0x49, 0x4C, 0x4D, 0x43, 0x43, 0x44, 0x2D, 0x52, 0x41, 0x57])], note: "Fujifilm RAF signature matched")
      ]
    ),
    "orf": Spec(
      id: "orf",
      label: "Olympus ORF",
      kind: "raw",
      extensions: ["orf"],
      mimeTypes: ["image/x-olympus-orf"],
      uti: "com.olympus.raw-image",
      importOnly: true,
      supportsAlpha: false,
      signatures: [
      Signature(clauses: [Clause(offset: 0, bytes: [0x49, 0x49, 0x52, 0x4F])], note: "IIRO"),
      Signature(clauses: [Clause(offset: 0, bytes: [0x49, 0x49, 0x52, 0x53])], note: "IIRS"),
      Signature(clauses: [Clause(offset: 0, bytes: [0x4D, 0x4D, 0x4F, 0x52])], note: "MMOR")
      ]
    )
    ]
}
