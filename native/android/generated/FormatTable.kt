// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0
//
// GENERATED FILE — DO NOT EDIT.
// Source: src/engine/formats.ts   Regenerate: npm run formats:gen

package com.owaiskhan.converter.format

/**
 * The format table, compiled from the TypeScript source of truth.
 * Matching logic lives in FormatTableSupport.kt; this file is data only.
 */
public object FormatTable {

  public data class Clause(val offset: Int, val bytes: ByteArray) {
    override fun equals(other: Any?): Boolean =
      this === other || (other is Clause && offset == other.offset && bytes.contentEquals(other.bytes))

    override fun hashCode(): Int = 31 * offset + bytes.contentHashCode()
  }

  public data class Signature(val clauses: List<Clause>, val note: String)

  public data class Spec(
    val id: String,
    val label: String,
    val kind: String,
    val extensions: List<String>,
    val mimeTypes: List<String>,
    val uti: String,
    val importOnly: Boolean,
    val supportsAlpha: Boolean,
    val signatures: List<Signature>,
  )

  /**
   * Order matters: formats whose signatures are subsets of another's are tested
   * first, or the looser pattern wins.
   */
  @JvmField
  public val DETECTION_ORDER: List<String> = listOf(
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
    "svg",
  )

  @JvmField
  public val ALL_FORMAT_IDS: List<String> = listOf(
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
    "orf",
  )

  @JvmField
  public val SPECS: Map<String, Spec> = mapOf(
    "jpeg" to Spec(
      id = "jpeg",
      label = "JPEG",
      kind = "raster",
      extensions = listOf("jpg", "jpeg", "jpe", "jfif"),
      mimeTypes = listOf("image/jpeg"),
      uti = "public.jpeg",
      importOnly = false,
      supportsAlpha = false,
      signatures = listOf(
        Signature(listOf(Clause(0, byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte()))), "SOI marker")
      ),
    ),
    "png" to Spec(
      id = "png",
      label = "PNG",
      kind = "raster",
      extensions = listOf("png"),
      mimeTypes = listOf("image/png"),
      uti = "public.png",
      importOnly = false,
      supportsAlpha = true,
      signatures = listOf(
        Signature(listOf(Clause(0, byteArrayOf(0x89.toByte(), 0x50.toByte(), 0x4E.toByte(), 0x47.toByte(), 0x0D.toByte(), 0x0A.toByte(), 0x1A.toByte(), 0x0A.toByte()))), "PNG signature; APNG is a PNG with an acTL chunk")
      ),
    ),
    "gif" to Spec(
      id = "gif",
      label = "GIF",
      kind = "raster",
      extensions = listOf("gif"),
      mimeTypes = listOf("image/gif"),
      uti = "com.compuserve.gif",
      importOnly = false,
      supportsAlpha = true,
      signatures = listOf(
        Signature(listOf(Clause(0, byteArrayOf(0x47.toByte(), 0x49.toByte(), 0x46.toByte(), 0x38.toByte(), 0x37.toByte(), 0x61.toByte()))), "GIF signature matched"),
        Signature(listOf(Clause(0, byteArrayOf(0x47.toByte(), 0x49.toByte(), 0x46.toByte(), 0x38.toByte(), 0x39.toByte(), 0x61.toByte()))), "GIF signature matched")
      ),
    ),
    "bmp" to Spec(
      id = "bmp",
      label = "BMP",
      kind = "raster",
      extensions = listOf("bmp", "dib"),
      mimeTypes = listOf("image/bmp"),
      uti = "com.microsoft.bmp",
      importOnly = false,
      supportsAlpha = true,
      signatures = listOf(
        Signature(listOf(Clause(0, byteArrayOf(0x42.toByte(), 0x4D.toByte()))), "BMP signature matched")
      ),
    ),
    "webp" to Spec(
      id = "webp",
      label = "WebP",
      kind = "raster",
      extensions = listOf("webp"),
      mimeTypes = listOf("image/webp"),
      uti = "org.webmproject.webp",
      importOnly = false,
      supportsAlpha = true,
      signatures = listOf(
        Signature(listOf(Clause(0, byteArrayOf(0x52.toByte(), 0x49.toByte(), 0x46.toByte(), 0x46.toByte())), Clause(8, byteArrayOf(0x57.toByte(), 0x45.toByte(), 0x42.toByte(), 0x50.toByte()))), "RIFF container with a WEBP form type; the VP8/VP8L/VP8X chunk follows")
      ),
    ),
    "tiff" to Spec(
      id = "tiff",
      label = "TIFF",
      kind = "raster",
      extensions = listOf("tif", "tiff"),
      mimeTypes = listOf("image/tiff"),
      uti = "public.tiff",
      importOnly = false,
      supportsAlpha = true,
      signatures = listOf(
        Signature(listOf(Clause(0, byteArrayOf(0x49.toByte(), 0x49.toByte(), 0x2A.toByte(), 0x00.toByte()))), "little-endian TIFF"),
        Signature(listOf(Clause(0, byteArrayOf(0x4D.toByte(), 0x4D.toByte(), 0x00.toByte(), 0x2A.toByte()))), "big-endian TIFF")
      ),
    ),
    "ico" to Spec(
      id = "ico",
      label = "ICO",
      kind = "raster",
      extensions = listOf("ico"),
      mimeTypes = listOf("image/x-icon", "image/vnd.microsoft.icon"),
      uti = "com.microsoft.ico",
      importOnly = false,
      supportsAlpha = true,
      signatures = listOf(
        Signature(listOf(Clause(0, byteArrayOf(0x00.toByte(), 0x00.toByte(), 0x01.toByte(), 0x00.toByte()))), "ICO signature matched")
      ),
    ),
    "heic" to Spec(
      id = "heic",
      label = "HEIC",
      kind = "raster",
      extensions = listOf("heic", "heics"),
      mimeTypes = listOf("image/heic", "image/heic-sequence"),
      uti = "public.heic",
      importOnly = false,
      supportsAlpha = true,
      signatures = listOf(
        Signature(listOf(Clause(4, byteArrayOf(0x66.toByte(), 0x74.toByte(), 0x79.toByte(), 0x70.toByte())), Clause(8, byteArrayOf(0x68.toByte(), 0x65.toByte(), 0x69.toByte(), 0x63.toByte()))), "ISO base media file format, major or compatible brand \"heic\""),
        Signature(listOf(Clause(4, byteArrayOf(0x66.toByte(), 0x74.toByte(), 0x79.toByte(), 0x70.toByte())), Clause(8, byteArrayOf(0x68.toByte(), 0x65.toByte(), 0x69.toByte(), 0x78.toByte()))), "ISO base media file format, major or compatible brand \"heix\""),
        Signature(listOf(Clause(4, byteArrayOf(0x66.toByte(), 0x74.toByte(), 0x79.toByte(), 0x70.toByte())), Clause(8, byteArrayOf(0x68.toByte(), 0x65.toByte(), 0x76.toByte(), 0x63.toByte()))), "ISO base media file format, major or compatible brand \"hevc\""),
        Signature(listOf(Clause(4, byteArrayOf(0x66.toByte(), 0x74.toByte(), 0x79.toByte(), 0x70.toByte())), Clause(8, byteArrayOf(0x68.toByte(), 0x65.toByte(), 0x76.toByte(), 0x78.toByte()))), "ISO base media file format, major or compatible brand \"hevx\""),
        Signature(listOf(Clause(4, byteArrayOf(0x66.toByte(), 0x74.toByte(), 0x79.toByte(), 0x70.toByte())), Clause(8, byteArrayOf(0x68.toByte(), 0x65.toByte(), 0x69.toByte(), 0x6D.toByte()))), "ISO base media file format, major or compatible brand \"heim\""),
        Signature(listOf(Clause(4, byteArrayOf(0x66.toByte(), 0x74.toByte(), 0x79.toByte(), 0x70.toByte())), Clause(8, byteArrayOf(0x68.toByte(), 0x65.toByte(), 0x69.toByte(), 0x73.toByte()))), "ISO base media file format, major or compatible brand \"heis\""),
        Signature(listOf(Clause(4, byteArrayOf(0x66.toByte(), 0x74.toByte(), 0x79.toByte(), 0x70.toByte())), Clause(8, byteArrayOf(0x68.toByte(), 0x65.toByte(), 0x76.toByte(), 0x6D.toByte()))), "ISO base media file format, major or compatible brand \"hevm\""),
        Signature(listOf(Clause(4, byteArrayOf(0x66.toByte(), 0x74.toByte(), 0x79.toByte(), 0x70.toByte())), Clause(8, byteArrayOf(0x68.toByte(), 0x65.toByte(), 0x76.toByte(), 0x73.toByte()))), "ISO base media file format, major or compatible brand \"hevs\"")
      ),
    ),
    "heif" to Spec(
      id = "heif",
      label = "HEIF",
      kind = "raster",
      extensions = listOf("heif", "hif"),
      mimeTypes = listOf("image/heif", "image/heif-sequence"),
      uti = "public.heif",
      importOnly = false,
      supportsAlpha = true,
      signatures = listOf(
        Signature(listOf(Clause(4, byteArrayOf(0x66.toByte(), 0x74.toByte(), 0x79.toByte(), 0x70.toByte())), Clause(8, byteArrayOf(0x6D.toByte(), 0x69.toByte(), 0x66.toByte(), 0x31.toByte()))), "ISO base media file format, major or compatible brand \"mif1\""),
        Signature(listOf(Clause(4, byteArrayOf(0x66.toByte(), 0x74.toByte(), 0x79.toByte(), 0x70.toByte())), Clause(8, byteArrayOf(0x6D.toByte(), 0x73.toByte(), 0x66.toByte(), 0x31.toByte()))), "ISO base media file format, major or compatible brand \"msf1\"")
      ),
    ),
    "avif" to Spec(
      id = "avif",
      label = "AVIF",
      kind = "raster",
      extensions = listOf("avif", "avifs"),
      mimeTypes = listOf("image/avif", "image/avif-sequence"),
      uti = "public.avif",
      importOnly = false,
      supportsAlpha = true,
      signatures = listOf(
        Signature(listOf(Clause(4, byteArrayOf(0x66.toByte(), 0x74.toByte(), 0x79.toByte(), 0x70.toByte())), Clause(8, byteArrayOf(0x61.toByte(), 0x76.toByte(), 0x69.toByte(), 0x66.toByte()))), "ISO base media file format, major or compatible brand \"avif\""),
        Signature(listOf(Clause(4, byteArrayOf(0x66.toByte(), 0x74.toByte(), 0x79.toByte(), 0x70.toByte())), Clause(8, byteArrayOf(0x61.toByte(), 0x76.toByte(), 0x69.toByte(), 0x73.toByte()))), "ISO base media file format, major or compatible brand \"avis\"")
      ),
    ),
    "svg" to Spec(
      id = "svg",
      label = "SVG",
      kind = "vector",
      extensions = listOf("svg"),
      mimeTypes = listOf("image/svg+xml"),
      uti = "public.svg-image",
      importOnly = true,
      supportsAlpha = true,
      signatures = listOf(
        
      ),
    ),
    "pdf" to Spec(
      id = "pdf",
      label = "PDF",
      kind = "document",
      extensions = listOf("pdf"),
      mimeTypes = listOf("application/pdf"),
      uti = "com.adobe.pdf",
      importOnly = false,
      supportsAlpha = false,
      signatures = listOf(
        Signature(listOf(Clause(0, byteArrayOf(0x25.toByte(), 0x50.toByte(), 0x44.toByte(), 0x46.toByte(), 0x2D.toByte()))), "Readers tolerate leading junk, so a prefix scan is also performed")
      ),
    ),
    "dng" to Spec(
      id = "dng",
      label = "Adobe DNG",
      kind = "raw",
      extensions = listOf("dng"),
      mimeTypes = listOf("image/x-adobe-dng"),
      uti = "com.adobe.raw-image",
      importOnly = true,
      supportsAlpha = false,
      signatures = listOf(
        Signature(listOf(Clause(0, byteArrayOf(0x49.toByte(), 0x49.toByte(), 0x2A.toByte(), 0x00.toByte()))), "Adobe DNG signature matched"),
        Signature(listOf(Clause(0, byteArrayOf(0x4D.toByte(), 0x4D.toByte(), 0x00.toByte(), 0x2A.toByte()))), "Adobe DNG signature matched")
      ),
    ),
    "cr2" to Spec(
      id = "cr2",
      label = "Canon CR2",
      kind = "raw",
      extensions = listOf("cr2"),
      mimeTypes = listOf("image/x-canon-cr2"),
      uti = "com.canon.cr2-raw-image",
      importOnly = true,
      supportsAlpha = false,
      signatures = listOf(
        Signature(listOf(Clause(0, byteArrayOf(0x49.toByte(), 0x49.toByte(), 0x2A.toByte(), 0x00.toByte())), Clause(8, byteArrayOf(0x43.toByte(), 0x52.toByte()))), "TIFF header with the Canon CR2 marker at offset 8")
      ),
    ),
    "cr3" to Spec(
      id = "cr3",
      label = "Canon CR3",
      kind = "raw",
      extensions = listOf("cr3"),
      mimeTypes = listOf("image/x-canon-cr3"),
      uti = "com.canon.cr3-raw-image",
      importOnly = true,
      supportsAlpha = false,
      signatures = listOf(
        Signature(listOf(Clause(4, byteArrayOf(0x66.toByte(), 0x74.toByte(), 0x79.toByte(), 0x70.toByte())), Clause(8, byteArrayOf(0x63.toByte(), 0x72.toByte(), 0x78.toByte(), 0x20.toByte()))), "ISO base media file format, major or compatible brand \"crx \"")
      ),
    ),
    "nef" to Spec(
      id = "nef",
      label = "Nikon NEF",
      kind = "raw",
      extensions = listOf("nef", "nrw"),
      mimeTypes = listOf("image/x-nikon-nef"),
      uti = "com.nikon.raw-image",
      importOnly = true,
      supportsAlpha = false,
      signatures = listOf(
        Signature(listOf(Clause(0, byteArrayOf(0x4D.toByte(), 0x4D.toByte(), 0x00.toByte(), 0x2A.toByte()))), "Nikon NEF signature matched"),
        Signature(listOf(Clause(0, byteArrayOf(0x49.toByte(), 0x49.toByte(), 0x2A.toByte(), 0x00.toByte()))), "Nikon NEF signature matched")
      ),
    ),
    "arw" to Spec(
      id = "arw",
      label = "Sony ARW",
      kind = "raw",
      extensions = listOf("arw", "sr2", "srf"),
      mimeTypes = listOf("image/x-sony-arw"),
      uti = "com.sony.raw-image",
      importOnly = true,
      supportsAlpha = false,
      signatures = listOf(
        Signature(listOf(Clause(0, byteArrayOf(0x49.toByte(), 0x49.toByte(), 0x2A.toByte(), 0x00.toByte()))), "Sony ARW signature matched")
      ),
    ),
    "raf" to Spec(
      id = "raf",
      label = "Fujifilm RAF",
      kind = "raw",
      extensions = listOf("raf"),
      mimeTypes = listOf("image/x-fuji-raf"),
      uti = "com.fuji.raw-image",
      importOnly = true,
      supportsAlpha = false,
      signatures = listOf(
        Signature(listOf(Clause(0, byteArrayOf(0x46.toByte(), 0x55.toByte(), 0x4A.toByte(), 0x49.toByte(), 0x46.toByte(), 0x49.toByte(), 0x4C.toByte(), 0x4D.toByte(), 0x43.toByte(), 0x43.toByte(), 0x44.toByte(), 0x2D.toByte(), 0x52.toByte(), 0x41.toByte(), 0x57.toByte()))), "Fujifilm RAF signature matched")
      ),
    ),
    "orf" to Spec(
      id = "orf",
      label = "Olympus ORF",
      kind = "raw",
      extensions = listOf("orf"),
      mimeTypes = listOf("image/x-olympus-orf"),
      uti = "com.olympus.raw-image",
      importOnly = true,
      supportsAlpha = false,
      signatures = listOf(
        Signature(listOf(Clause(0, byteArrayOf(0x49.toByte(), 0x49.toByte(), 0x52.toByte(), 0x4F.toByte()))), "IIRO"),
        Signature(listOf(Clause(0, byteArrayOf(0x49.toByte(), 0x49.toByte(), 0x52.toByte(), 0x53.toByte()))), "IIRS"),
        Signature(listOf(Clause(0, byteArrayOf(0x4D.toByte(), 0x4D.toByte(), 0x4F.toByte(), 0x52.toByte()))), "MMOR")
      ),
    ),
  )
}
