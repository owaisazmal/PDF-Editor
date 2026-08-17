#!/usr/bin/env node
// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Compiles src/engine/formats.ts into native format tables.
 *
 * The detection *rules* — which signature identifies which format, and in what order
 * they must be tested — are the part most likely to drift between three
 * implementations, and a drift here is invisible until a user's file is misidentified.
 * So the table is data, authored once, and emitted into Swift and Kotlin. Only the
 * matching logic is written per platform, and the conformance test proves the three
 * agree on the fixture corpus.
 *
 * Emits:
 *   native/ios/generated/FormatTable.swift
 *   native/android/generated/FormatTable.kt
 *
 * Usage:
 *   node scripts/gen-formats.mjs            write the files
 *   node scripts/gen-formats.mjs --check    fail if the files are stale (CI)
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

const { FORMATS, ALL_FORMAT_IDS, DETECTION_ORDER } = await import(
  pathToFileURL(join(ROOT, 'src/engine/formats.ts')).href
);

const BANNER = `// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0
//
// GENERATED FILE — DO NOT EDIT.
// Source: src/engine/formats.ts   Regenerate: npm run formats:gen`;

/** ASCII in the table is written as a string for readability; emit it as bytes. */
const toByteArray = (bytes) =>
  typeof bytes === 'string' ? Array.from(bytes, (c) => c.charCodeAt(0)) : Array.from(bytes);

const hex = (n) => `0x${n.toString(16).padStart(2, '0').toUpperCase()}`;
const quote = (s) => JSON.stringify(s);

/* -------------------------------------------------------------------- swift ---- */

function renderSwift() {
  const spec = (id) => {
    const f = FORMATS[id];
    const signatures = f.signatures
      .map((sig) => {
        const clauses = sig.clauses
          .map((c) => `Clause(offset: ${c.offset}, bytes: [${toByteArray(c.bytes).map(hex).join(', ')}])`)
          .join(', ');
        return `      Signature(clauses: [${clauses}], note: ${quote(sig.note ?? `${f.label} signature matched`)})`;
      })
      .join(',\n');

    return `    ${quote(id)}: Spec(
      id: ${quote(id)},
      label: ${quote(f.label)},
      kind: ${quote(f.kind)},
      extensions: [${f.extensions.map(quote).join(', ')}],
      mimeTypes: [${f.mimeTypes.map(quote).join(', ')}],
      uti: ${quote(f.uti)},
      importOnly: ${f.importOnly},
      supportsAlpha: ${f.supportsAlpha},
      signatures: [
${signatures || '        '}
      ]
    )`;
  };

  return `${BANNER}

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
${DETECTION_ORDER.map((id) => `        ${quote(id)}`).join(',\n')}
    ]

    public static let allFormatIds: [String] = [
${ALL_FORMAT_IDS.map((id) => `        ${quote(id)}`).join(',\n')}
    ]

    public static let specs: [String: Spec] = [
${ALL_FORMAT_IDS.map(spec).join(',\n')}
    ]
}
`;
}

/* ------------------------------------------------------------------- kotlin ---- */

function renderKotlin() {
  const spec = (id) => {
    const f = FORMATS[id];
    const signatures = f.signatures
      .map((sig) => {
        const clauses = sig.clauses
          .map(
            (c) =>
              `Clause(${c.offset}, byteArrayOf(${toByteArray(c.bytes)
                .map((b) => `${hex(b)}.toByte()`)
                .join(', ')}))`,
          )
          .join(', ');
        return `        Signature(listOf(${clauses}), ${quote(sig.note ?? `${f.label} signature matched`)})`;
      })
      .join(',\n');

    return `    ${quote(id)} to Spec(
      id = ${quote(id)},
      label = ${quote(f.label)},
      kind = ${quote(f.kind)},
      extensions = listOf(${f.extensions.map(quote).join(', ')}),
      mimeTypes = listOf(${f.mimeTypes.map(quote).join(', ')}),
      uti = ${quote(f.uti)},
      importOnly = ${f.importOnly},
      supportsAlpha = ${f.supportsAlpha},
      signatures = listOf(
${signatures || '        '}
      ),
    )`;
  };

  return `${BANNER}

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
${DETECTION_ORDER.map((id) => `    ${quote(id)}`).join(',\n')},
  )

  @JvmField
  public val ALL_FORMAT_IDS: List<String> = listOf(
${ALL_FORMAT_IDS.map((id) => `    ${quote(id)}`).join(',\n')},
  )

  @JvmField
  public val SPECS: Map<String, Spec> = mapOf(
${ALL_FORMAT_IDS.map(spec).join(',\n')},
  )
}
`;
}

/* -------------------------------------------------------------------- write ---- */

const outputs = [
  ['native/ios/generated/FormatTable.swift', renderSwift()],
  ['native/android/generated/FormatTable.kt', renderKotlin()],
];

let stale = 0;
for (const [relPath, content] of outputs) {
  const absolute = join(ROOT, relPath);
  const existing = await readFile(absolute, 'utf8').catch(() => null);

  if (CHECK_ONLY) {
    if (existing !== content) {
      stale += 1;
      console.error(existing === null ? `missing   ${relPath}` : `stale     ${relPath}`);
    }
    continue;
  }

  if (existing === content) {
    console.log(`unchanged ${relPath}`);
    continue;
  }
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf8');
  console.log(`wrote     ${relPath}`);
}

if (CHECK_ONLY) {
  if (stale > 0) {
    console.error(`\n${stale} generated file(s) out of date. Run: npm run formats:gen`);
    process.exit(1);
  }
  console.log('generated format tables are up to date');
}
