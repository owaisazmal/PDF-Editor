#!/usr/bin/env node
// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Draws the app icon, adaptive icon and splash mark from the token palette.
 *
 * The alternative was checking in binary artwork that nobody can regenerate and that
 * silently stops matching the palette the moment a colour changes. Generating them
 * keeps the brand assets on the same footing as `Tokens.swift` and `FormatTable.kt`:
 * one source, reproducible output, and a CI check that they are current.
 *
 * The mark is an arrow — the whole product is "this file becomes that file", and an
 * arrow says it in every locale without a word of text.
 *
 * PNGs are written by hand with zlib because the toolchain has no image library, and
 * adding one for four static files is not a trade worth making.
 *
 * Usage:
 *   node scripts/gen-app-icons.mjs            write the files
 *   node scripts/gen-app-icons.mjs --check    fail if they are stale (CI)
 */

import { deflateSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

const { palette, colors } = await import(pathToFileURL(join(ROOT, 'src/theme/tokens.ts')).href);

/* ------------------------------------------------------------------- drawing ---- */

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Distance from a point to a line segment, used to draw strokes with round caps. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Coverage of the arrow at a point, in unit coordinates. Three round-capped strokes:
 * a shaft and two head strokes meeting at the tip.
 */
function arrowCoverage(x, y, stroke) {
  const tipX = 0.735;
  const midY = 0.5;
  const d = Math.min(
    distanceToSegment(x, y, 0.265, midY, tipX, midY),
    distanceToSegment(x, y, tipX, midY, 0.545, 0.31),
    distanceToSegment(x, y, tipX, midY, 0.545, 0.69),
  );
  return d <= stroke ? 1 : 0;
}

/** Signed coverage of a rounded square, in unit coordinates. */
function roundedSquareCoverage(x, y, inset, radius) {
  const min = inset;
  const max = 1 - inset;
  if (x < min || x > max || y < min || y > max) return 0;

  const cx = Math.min(Math.max(x, min + radius), max - radius);
  const cy = Math.min(Math.max(y, min + radius), max - radius);
  return Math.hypot(x - cx, y - cy) <= radius ? 1 : 0;
}

/**
 * Renders one icon. `samples` is the supersampling factor — the marks are pure
 * geometry, so 4x4 averaging is enough to look clean at every size the stores ask for.
 */
function renderIcon({ size, background, mark, stroke, plate, plateInset, plateRadius }) {
  const samples = 4;
  const pixels = Buffer.alloc(size * size * 4);
  const markRgb = hexToRgb(mark);
  const backgroundRgb = background ? hexToRgb(background) : null;
  const plateRgb = plate ? hexToRgb(plate) : null;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let plateHits = 0;
      let markHits = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px + (sx + 0.5) / samples) / size;
          const y = (py + (sy + 0.5) / samples) / size;
          if (plateRgb) plateHits += roundedSquareCoverage(x, y, plateInset, plateRadius);
          markHits += arrowCoverage(x, y, stroke);
        }
      }

      const total = samples * samples;
      const plateAlpha = plateHits / total;
      const markAlpha = markHits / total;

      // Composite back to front: background, plate, mark.
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      if (backgroundRgb) {
        [r, g, b] = backgroundRgb;
        a = 1;
      }
      if (plateRgb && plateAlpha > 0) {
        r = r * (1 - plateAlpha) + plateRgb[0] * plateAlpha;
        g = g * (1 - plateAlpha) + plateRgb[1] * plateAlpha;
        b = b * (1 - plateAlpha) + plateRgb[2] * plateAlpha;
        a = a + (1 - a) * plateAlpha;
      }
      if (markAlpha > 0) {
        r = r * (1 - markAlpha) + markRgb[0] * markAlpha;
        g = g * (1 - markAlpha) + markRgb[1] * markAlpha;
        b = b * (1 - markAlpha) + markRgb[2] * markAlpha;
        a = a + (1 - a) * markAlpha;
      }

      const offset = (py * size + px) * 4;
      pixels[offset] = Math.round(r);
      pixels[offset + 1] = Math.round(g);
      pixels[offset + 2] = Math.round(b);
      pixels[offset + 3] = Math.round(a * 255);
    }
  }

  return encodePng(size, size, pixels);
}

/* ---------------------------------------------------------------------- png ----- */

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

let crcTable = null;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc ^ -1;
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * The Play Store feature graphic: 1024x500, mandatory, and refused if it is absent.
 *
 * Composed from the same primitives as the icons rather than drawn by hand, so it cannot
 * drift from the palette and CI can tell when it is stale.
 *
 * The mark sits left of centre and the rest is empty cream on purpose. Play overlays the app
 * icon and title across the middle of this image in several placements, and anything put
 * there is either hidden or fighting for the same space. Empty is a composition here, not a
 * shortage of ideas.
 */
function renderFeatureGraphic({ width, height, background, plate, mark, stroke }) {
  const samples = 4;
  const pixels = Buffer.alloc(width * height * 4);
  const backgroundRgb = hexToRgb(background);
  const plateRgb = hexToRgb(plate);
  const markRgb = hexToRgb(mark);

  // The square the mark is drawn into, in pixels: centred vertically, a third of the way
  // across, and sized to leave generous air above and below.
  const box = Math.round(height * 0.62);
  const boxLeft = Math.round(width * 0.14);
  const boxTop = Math.round((height - box) / 2);

  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      let plateHits = 0;
      let markHits = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          // Sample position expressed inside the mark's own square, so the icon geometry
          // is reused unchanged rather than re-derived for a rectangle.
          const x = (px + (sx + 0.5) / samples - boxLeft) / box;
          const y = (py + (sy + 0.5) / samples - boxTop) / box;
          if (x < 0 || x > 1 || y < 0 || y > 1) continue;
          plateHits += roundedSquareCoverage(x, y, 0.02, 0.17);
          markHits += arrowCoverage(x, y, 0.052);
        }
      }

      const total = samples * samples;
      const plateAlpha = plateHits / total;
      const markAlpha = markHits / total;

      let [r, g, b] = backgroundRgb;
      if (plateAlpha > 0) {
        r = r * (1 - plateAlpha) + plateRgb[0] * plateAlpha;
        g = g * (1 - plateAlpha) + plateRgb[1] * plateAlpha;
        b = b * (1 - plateAlpha) + plateRgb[2] * plateAlpha;
      }
      if (markAlpha > 0) {
        r = r * (1 - markAlpha) + markRgb[0] * markAlpha;
        g = g * (1 - markAlpha) + markRgb[1] * markAlpha;
        b = b * (1 - markAlpha) + markRgb[2] * markAlpha;
      }

      const offset = (py * width + px) * 4;
      pixels[offset] = Math.round(r);
      pixels[offset + 1] = Math.round(g);
      pixels[offset + 2] = Math.round(b);
      pixels[offset + 3] = 255;
    }
  }

  return encodePng(width, height, pixels);
}

/* -------------------------------------------------------------------- write ----- */

const outputs = [
  // iOS: opaque, full bleed. The system applies its own mask.
  ['assets/icon.png', renderIcon({
    size: 1024,
    background: palette.cream,
    plate: palette.amber,
    plateInset: 0.13,
    plateRadius: 0.17,
    mark: colors.light.textOnAccent,
    stroke: 0.052,
  })],
  // Android adaptive foreground: transparent, mark inside the 66% safe zone.
  ['assets/adaptive-icon.png', renderIcon({
    size: 1024,
    background: null,
    plate: palette.amber,
    plateInset: 0.20,
    plateRadius: 0.14,
    mark: colors.light.textOnAccent,
    stroke: 0.040,
  })],
  // Splash mark: no plate, drawn in the brand's text-safe brown on the cream ground.
  ['assets/splash-icon.png', renderIcon({
    size: 512,
    background: null,
    plate: null,
    mark: palette.sienna,
    stroke: 0.055,
  })],
  ['assets/favicon.png', renderIcon({
    size: 96,
    background: palette.cream,
    plate: palette.amber,
    plateInset: 0.10,
    plateRadius: 0.18,
    mark: colors.light.textOnAccent,
    stroke: 0.055,
  })],
  // Play refuses a listing without this, at exactly this size.
  ['store/play/feature-graphic.png', renderFeatureGraphic({
    width: 1024,
    height: 500,
    background: palette.cream,
    plate: palette.amber,
    mark: colors.light.textOnAccent,
  })],
  // Play also wants a 512x512 icon, separately from the one in the binary.
  ['store/play/icon-512.png', renderIcon({
    size: 512,
    background: palette.cream,
    plate: palette.amber,
    plateInset: 0.13,
    plateRadius: 0.17,
    mark: colors.light.textOnAccent,
    stroke: 0.052,
  })],
];

let stale = 0;
for (const [relPath, buffer] of outputs) {
  const absolute = join(ROOT, relPath);
  const existing = await readFile(absolute).catch(() => null);

  if (CHECK_ONLY) {
    if (!existing || !existing.equals(buffer)) {
      stale += 1;
      console.error(existing ? `stale     ${relPath}` : `missing   ${relPath}`);
    }
    continue;
  }

  if (existing && existing.equals(buffer)) {
    console.log(`unchanged ${relPath}`);
    continue;
  }
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, buffer);
  console.log(`wrote     ${relPath} (${buffer.length} bytes)`);
}

if (CHECK_ONLY) {
  if (stale > 0) {
    console.error(`\n${stale} icon(s) out of date. Run: npm run icons:gen`);
    process.exit(1);
  }
  console.log('generated icons are up to date');
}
