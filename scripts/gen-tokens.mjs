#!/usr/bin/env node
// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Compiles src/theme/tokens.ts into native token sources and a measured contrast
 * report, so the iOS share extension, the Android share target and the docs all
 * read from one palette instead of three drifting copies.
 *
 * Emits:
 *   native/ios/generated/Tokens.swift       dependency-free RGBA structs
 *   native/android/generated/Tokens.kt      dependency-free ARGB longs
 *   docs/CONTRAST.md                        measured ratios for every declared pair
 *
 * Usage:
 *   node scripts/gen-tokens.mjs            write the files
 *   node scripts/gen-tokens.mjs --check    fail if the files are stale (CI)
 *
 * Node 24 strips TypeScript types natively, so this reads the real token module
 * rather than parsing it. Keep tokens.ts free of non-erasable syntax (`enum`,
 * `namespace`) or that stops being true.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

const { tokens, colors, CONTRAST_CONTRACT } = await import(
  pathToFileURL(join(ROOT, 'src/theme/tokens.ts')).href
);
const { contrastRatioRounded } = await import(
  pathToFileURL(join(ROOT, 'src/theme/contrast.ts')).href
);

const BANNER = `// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0
//
// GENERATED FILE — DO NOT EDIT.
// Source: src/theme/tokens.ts   Regenerate: npm run tokens:gen`;

/* ------------------------------------------------------------------ colour ---- */

/** Parses #RGB, #RRGGBB or rgba()/rgb() into 0–255 channels plus 0–1 alpha. */
function parseColor(value) {
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value);
  if (hex) {
    const h =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map((c) => c + c)
            .join('')
        : hex[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  const fn = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(value);
  if (fn) {
    return {
      r: Number(fn[1]),
      g: Number(fn[2]),
      b: Number(fn[3]),
      a: fn[4] === undefined ? 1 : Number(fn[4]),
    };
  }
  throw new Error(`Cannot parse colour token "${value}". Use #RRGGBB or rgba(r, g, b, a).`);
}

const toUnit = (n) => (n / 255).toFixed(4);
const toArgb = ({ r, g, b, a }) => {
  const byte = (n) => Math.round(n).toString(16).padStart(2, '0').toUpperCase();
  return `0x${byte(a * 255)}${byte(r)}${byte(g)}${byte(b)}`;
};

const COLOR_ROLES = Object.keys(colors.light);

/* ------------------------------------------------------------------- swift ---- */

function renderSwift() {
  const roleProps = COLOR_ROLES.map((role) => `    public let ${role}: RGBA`).join('\n');
  const roleArgs = COLOR_ROLES.map((role) => `${role}: RGBA`).join(', ');
  const roleAssign = COLOR_ROLES.map((role) => `      self.${role} = ${role}`).join('\n');

  const scheme = (name) => {
    const args = COLOR_ROLES.map((role) => {
      const { r, g, b, a } = parseColor(colors[name][role]);
      return `      ${role}: RGBA(${toUnit(r)}, ${toUnit(g)}, ${toUnit(b)}, ${a.toFixed(4)})`;
    }).join(',\n');
    return `  public static let ${name} = ColorTokens(\n${args}\n  )`;
  };

  const scale = (obj, type, indent = '    ') =>
    Object.entries(obj)
      .map(([k, v]) => `${indent}public static let ${swiftName(k)}: ${type} = ${v}`)
      .join('\n');

  const typeStyles = Object.entries(tokens.typography)
    .map(
      ([name, s]) =>
        `    public static let ${swiftName(name)} = TypeStyle(` +
        `fontFamily: "${s.fontFamily}", fontSize: ${s.fontSize}, ` +
        `lineHeight: ${s.lineHeight}, letterSpacing: ${s.letterSpacing})`,
    )
    .join('\n');

  const elevations = Object.entries(tokens.elevation)
    .map(
      ([name, e]) =>
        `    public static let ${swiftName(name)} = Elevation(` +
        `opacity: ${e.opacity}, radius: ${e.radius}, offsetY: ${e.offsetY})`,
    )
    .join('\n');

  return `${BANNER}

import CoreGraphics
import Foundation

/// Design tokens shared by the app, the share extension and ConverterCore.
public enum Tokens {

  /// Straight (non-premultiplied) sRGB, 0...1 per channel.
  public struct RGBA: Equatable, Sendable {
    public let red: CGFloat
    public let green: CGFloat
    public let blue: CGFloat
    public let alpha: CGFloat

    public init(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat, _ alpha: CGFloat) {
      self.red = red
      self.green = green
      self.blue = blue
      self.alpha = alpha
    }
  }

  public struct TypeStyle: Equatable, Sendable {
    public let fontFamily: String
    public let fontSize: CGFloat
    public let lineHeight: CGFloat
    public let letterSpacing: CGFloat
  }

  public struct Elevation: Equatable, Sendable {
    public let opacity: CGFloat
    public let radius: CGFloat
    public let offsetY: CGFloat
  }

  public struct ColorTokens: Equatable, Sendable {
${roleProps}

    public init(${roleArgs}) {
${roleAssign}
    }
  }

${scheme('light')}

${scheme('dark')}

  public static func colors(dark: Bool) -> ColorTokens { dark ? Tokens.dark : Tokens.light }

  public enum Space {
${scale(tokens.space, 'CGFloat')}
  }

  public enum Radius {
${scale(tokens.radius, 'CGFloat')}
  }

  public enum Duration {
${scale(tokens.duration, 'TimeInterval', '    ')}
  }

  public enum FontFamily {
${Object.entries(tokens.fontFamily)
  .map(([k, v]) => `    public static let ${swiftName(k)} = "${v}"`)
  .join('\n')}
  }

  public enum Typography {
${typeStyles}
  }

  public enum Elevations {
${elevations}
  }

  public static let hitTarget: CGFloat = ${tokens.hitTarget}
}
`;
}

/* ------------------------------------------------------------------ kotlin ---- */

function renderKotlin() {
  const roleProps = COLOR_ROLES.map((role) => `  val ${role}: Long`).join(',\n');

  const scheme = (name) => {
    const args = COLOR_ROLES.map(
      (role) => `    ${role} = ${toArgb(parseColor(colors[name][role]))}`,
    ).join(',\n');
    return `  @JvmField\n  val ${name.toUpperCase()} = ColorTokens(\n${args},\n  )`;
  };

  const scale = (obj, type) =>
    Object.entries(obj)
      .map(([k, v]) => `    const val ${kotlinName(k)}: ${type} = ${v}`)
      .join('\n');

  const typeStyles = Object.entries(tokens.typography)
    .map(
      ([name, s]) =>
        `    @JvmField val ${kotlinName(name).toUpperCase()} = TypeStyle(` +
        `"${s.fontFamily}", ${s.fontSize}f, ${s.lineHeight}f, ${s.letterSpacing}f)`,
    )
    .join('\n');

  const elevations = Object.entries(tokens.elevation)
    .map(
      ([name, e]) =>
        `    @JvmField val ${kotlinName(name).toUpperCase()} = Elevation(` +
        `${e.opacity}f, ${e.radius}f, ${e.offsetY}f, ${e.androidElevation}f)`,
    )
    .join('\n');

  return `${BANNER}

package com.owaiskhan.converter.theme

/** Design tokens shared by the app, the share target and the converter library. */
public object Tokens {

  /** Packed ARGB, matching androidx.compose.ui.graphics.Color's constructor. */
  public data class ColorTokens(
${roleProps},
  )

  public data class TypeStyle(
    val fontFamily: String,
    val fontSize: Float,
    val lineHeight: Float,
    val letterSpacing: Float,
  )

  public data class Elevation(
    val opacity: Float,
    val radius: Float,
    val offsetY: Float,
    val androidElevation: Float,
  )

${scheme('light')}

${scheme('dark')}

  @JvmStatic
  public fun colors(dark: Boolean): ColorTokens = if (dark) DARK else LIGHT

  public object Space {
${scale(tokens.space, 'Int')}
  }

  public object Radius {
${scale(tokens.radius, 'Int')}
  }

  public object Duration {
${scale(tokens.duration, 'Long')}
  }

  public object FontFamily {
${Object.entries(tokens.fontFamily)
  .map(([k, v]) => `    const val ${kotlinName(k).toUpperCase()}: String = "${v}"`)
  .join('\n')}
  }

  public object Typography {
${typeStyles}
  }

  public object Elevations {
${elevations}
  }

  public const val HIT_TARGET: Int = ${tokens.hitTarget}
}
`;
}

/** `2xl` is not a valid identifier in Swift or Kotlin. */
function swiftName(key) {
  return /^\d/.test(key) ? `s${key}` : key;
}
function kotlinName(key) {
  return /^\d/.test(key) ? `S${key}` : key;
}

/* ---------------------------------------------------------------- contrast ---- */

function renderContrastReport() {
  const rows = (scheme) =>
    CONTRAST_CONTRACT.map(({ fg, bg, min }) => {
      const fgValue = colors[scheme][fg];
      const bgValue = colors[scheme][bg];
      const ratio = contrastRatioRounded(fgValue, bgValue);
      const verdict = ratio >= min ? 'pass' : 'FAIL';
      return `| \`${fg}\` | \`${fgValue}\` | \`${bg}\` | \`${bgValue}\` | **${ratio}:1** | ${min}:1 | ${verdict} |`;
    }).join('\n');

  const table = (scheme) => `### ${scheme[0].toUpperCase()}${scheme.slice(1)}

| Foreground | | Background | | Measured | Required | |
|---|---|---|---|---|---|---|
${rows(scheme)}`;

  return `# Measured contrast

Copyright (c) 2026 Owais Khan
Licensed under the Apache License, Version 2.0

GENERATED FILE — DO NOT EDIT. Source: \`src/theme/tokens.ts\`. Regenerate: \`npm run tokens:gen\`.

Every pairing below is declared in \`CONTRAST_CONTRACT\` and enforced by
\`__tests__/theme/contrast.test.ts\`. Thresholds follow WCAG 2.1: 4.5:1 for body text
(1.4.3) and 3:1 for non-text UI boundaries (1.4.11).

${table('light')}

${table('dark')}

## Roles deliberately excluded

- \`textDisabled\` — WCAG 1.4.3 exempts inactive controls.
- \`borderHairline\`, \`borderDefault\` — decorative dividers that convey no state.
- \`accentFill\` as a foreground — it is a fill. Its text counterpart is \`accentInk\`.
- \`bgScrim\` — translucent, so it has no fixed contrast without a known backdrop.
`;
}

/* -------------------------------------------------------------------- write ---- */

const outputs = [
  ['native/ios/generated/Tokens.swift', renderSwift()],
  ['native/android/generated/Tokens.kt', renderKotlin()],
  ['docs/CONTRAST.md', renderContrastReport()],
];

let stale = 0;
for (const [relPath, content] of outputs) {
  const absolute = join(ROOT, relPath);
  const existing = await readFile(absolute, 'utf8').catch(() => null);

  if (CHECK_ONLY) {
    if (existing !== content) {
      stale += 1;
      console.error(
        existing === null
          ? `missing   ${relPath}`
          : `stale     ${relPath}  (tokens.ts changed but the generated file was not updated)`,
      );
    }
    continue;
  }

  if (existing === content) {
    console.log(`unchanged ${relPath}`);
    continue;
  }
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf8');
  console.log(`wrote     ${relative(ROOT, absolute)}`);
}

if (CHECK_ONLY) {
  if (stale > 0) {
    console.error(`\n${stale} generated file(s) out of date. Run: npm run tokens:gen`);
    process.exit(1);
  }
  console.log('generated token files are up to date');
}
