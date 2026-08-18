// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.core

import com.owaiskhan.converter.format.FormatTable

/**
 * Matching logic for the generated format table.
 *
 * The table is data compiled from `src/engine/formats.ts`; only this matching is
 * written by hand, and it is deliberately trivial so there is very little room for it
 * to disagree with the TypeScript reference implementation or the Swift one.
 */
public object FormatMatcher {

  public fun spec(formatId: String): FormatTable.Spec? = FormatTable.SPECS[formatId]

  /** True when any of the format's signatures matches the prefix. */
  public fun matches(bytes: ByteArray, formatId: String): Boolean {
    val spec = FormatTable.SPECS[formatId] ?: return false
    return spec.signatures.any { matches(bytes, it) }
  }

  /** The note on whichever signature matched, used as the detection reason. */
  public fun note(bytes: ByteArray, formatId: String): String {
    val spec = FormatTable.SPECS[formatId] ?: return ""
    return spec.signatures.firstOrNull { matches(bytes, it) }?.note
      ?: "${spec.label} signature matched"
  }

  private fun matches(bytes: ByteArray, signature: FormatTable.Signature): Boolean =
    signature.clauses.all { clause ->
      if (clause.offset < 0 || clause.offset + clause.bytes.size > bytes.size) {
        false
      } else {
        clause.bytes.indices.all { i -> bytes[clause.offset + i] == clause.bytes[i] }
      }
    }

  /** What a filename claims. Used only to report a mismatch, never to decide. */
  public fun formatIdForFilename(filename: String): String? {
    val ext = filename.substringAfterLast('.', "").lowercase()
    if (ext.isEmpty() || ext == filename.lowercase()) return null
    return FormatTable.ALL_FORMAT_IDS.firstOrNull {
      FormatTable.SPECS[it]?.extensions?.contains(ext) == true
    }
  }

  /** Every MIME type the app registers intent filters for. */
  public val allMimeTypes: List<String>
    get() = FormatTable.ALL_FORMAT_IDS
      .mapNotNull { FormatTable.SPECS[it] }
      .flatMap { it.mimeTypes }
      .distinct()
}
