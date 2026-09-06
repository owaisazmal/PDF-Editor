#!/usr/bin/env node
// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Draws every brand asset from one piece of geometry and the token palette.
 *
 * The alternative was checking in artwork that nobody can regenerate and that silently
 * stops matching the palette the moment a colour changes. Generating it keeps the brand
 * on the same footing as `Tokens.swift` and `FormatTable.kt`: one source, reproducible
 * output, and a CI check that the files are current.
 *
 * The mark is a folded paper kite — see scripts/brand/mark.mjs for what it means and why.
 * It is drawn here in three colourways, each taken from the tokens rather than chosen:
 *
 *   on amber   the app icon: ink face and tail, cream flaps, on the accent fill
 *   on cream   the light logo: ink face and tail, amber flaps, on the light canvas
 *   on dark    the dark logo: cream face and tail, amber flaps, on the dark canvas
 *
 * Amber is the one colour the light and dark schemes share, so the flaps stay amber
 * wherever the ground is a canvas, and the "ink" is whatever the scheme uses for text.
 *
 * Outputs: the iOS icon in its light, dark and tinted forms; the Android adaptive
 * foreground and its monochrome layer; the light and dark splash marks; the favicon; the
 * Play Store icon and feature graphic; the SVG mark and lockup for the README; the
 * template layers the app tints at run time; the Android notification glyph; and the
 * hinge geometry the launch animation folds along.
 *
 * Usage:
 *   node scripts/gen-app-icons.mjs            write the files
 *   node scripts/gen-app-icons.mjs --check    fail if they are stale (CI)
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { markAndroidVector, markLayers, markShapes, markSvg, markSvgPaths } from './brand/mark.mjs';
import { render } from './brand/raster.mjs';
import { layoutText, loadTrueType, textPathData } from './brand/wordmark.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

const { palette, colors } = await import(pathToFileURL(join(ROOT, 'src/theme/tokens.ts')).href);

/* --------------------------------------------------------------- colourways ---- */

const ON_AMBER = { ink: colors.light.textOnAccent, fill: palette.cream };
const ON_CREAM = { ink: colors.light.textPrimary, fill: colors.light.accentFill };
const ON_DARK = { ink: colors.dark.textPrimary, fill: colors.dark.accentFill };

/**
 * iOS tints its "tinted" icon from luminance alone: white takes the full tint, darker
 * greys take a darker shade. These are therefore not colours, and not from the palette;
 * they are the two brightness levels that keep the fold visible once the system has
 * recoloured everything.
 */
const TINTED = { ink: '#FFFFFF', fill: '#B3B3B3' };

/** A mask. Android and the notification shade keep the alpha and discard the colour. */
const MASK = { ink: '#FFFFFF', fill: '#FFFFFF' };

/* ---------------------------------------------------------------- placement ---- */

/**
 * Where the mark sits on a square canvas.
 *
 * Centring its bounding box leaves the kite riding high and right, because the tail
 * drags the box down and left. Centring the kite alone leaves the tail sprawling into a
 * corner. The point that sits at the centre of the canvas is midway between the two: the
 * kite reads as centred, and the tail still belongs to the composition.
 */
function squarePlacement(canvas, box, overrides = {}) {
  const unit = markShapes({ x: 0, y: 0, size: 1, ...overrides });
  const [top, , bottom] = unit.outline;
  const kiteCentre = [(top[0] + bottom[0]) / 2, (top[1] + bottom[1]) / 2];
  const anchor = [(kiteCentre[0] + 0.5) / 2, (kiteCentre[1] + 0.5) / 2];
  return markShapes({
    x: canvas / 2 - anchor[0] * box,
    y: canvas / 2 - anchor[1] * box,
    size: box,
    ...overrides,
  });
}

/**
 * At small sizes the creases and the tail are drawn heavier than the mark's true
 * proportions, because a crease narrower than a pixel disappears and a tail thinner than
 * one turns to fuzz. Optical compensation, the same thing a type designer does.
 */
const SMALL = { crease: 0.075, tailWidth: 0.085 };

/* ------------------------------------------------------------------- icons ---- */

function icon({ size, background, colourway, box = 0.68, overrides = {} }) {
  const shapes = squarePlacement(size, size * box, overrides);
  return render({ width: size, height: size, background, layers: markLayers(shapes, colourway) });
}

/**
 * Android's adaptive icon is a 108dp canvas of which a 66dp circle is guaranteed visible,
 * so everything has to sit inside the middle 61%. The whole composition — tail included —
 * is fitted to that circle with a little to spare, centred on its bounding box.
 */
function adaptiveIcon({ size, colourway, overrides = {} }) {
  const box = size * 0.5;
  const shapes = markShapes({ x: (size - box) / 2, y: (size - box) / 2, size: box, ...overrides });
  return render({
    width: size,
    height: size,
    background: null,
    layers: markLayers(shapes, colourway),
  });
}

/** The splash mark: the unit square is the whole image, so `imageWidth` in app.json is the mark's box. */
function splash({ size, colourway }) {
  const shapes = markShapes({ x: 0, y: 0, size });
  return render({
    width: size,
    height: size,
    background: null,
    layers: markLayers(shapes, colourway),
  });
}

/**
 * The Play Store feature graphic: 1024x500, mandatory, and refused if it is absent.
 *
 * The mark sits left of centre and the rest is empty cream on purpose. Play overlays the
 * app icon and title across the middle of this image in several placements, and anything
 * put there is either hidden or fighting for the same space. Empty is a composition here,
 * not a shortage of ideas.
 */
function featureGraphic({ width, height }) {
  const box = height * 0.84;
  const shapes = markShapes({ x: width * 0.11, y: (height - box) / 2, size: box });
  return render({ width, height, background: palette.cream, layers: markLayers(shapes, ON_CREAM) });
}

/**
 * One layer of the mark, white on transparent, for the app to tint at run time.
 *
 * The app cannot load an SVG without a dependency it has no other use for, and a
 * flattened PNG would need a copy per scheme. A template image tinted with a token is
 * theme-correct by construction, and splitting the mark into its four parts lets the
 * launch animation fold each one on its own hinge.
 */
function layer({ size, part }) {
  const shapes = markShapes({ x: 0, y: 0, size });
  const shape =
    part === 'tail'
      ? { kind: 'stroke', points: shapes.tailPolyline, width: shapes.tailWidth }
      : { kind: 'polygon', points: shapes[part] };
  return render({
    width: size,
    height: size,
    background: null,
    layers: [{ color: '#FFFFFF', shapes: [shape] }],
  });
}

/* ------------------------------------------------------------------ lockup ---- */

const FONT = join(
  ROOT,
  'node_modules/@expo-google-fonts/manrope/800ExtraBold/Manrope_800ExtraBold.ttf',
);

/**
 * The mark beside the name, set in the same face as the app's headings.
 *
 * Proportions are in cap heights: the mark is 1.65 of them tall and sits with the kite
 * centred on the capitals, so the tail dips below the baseline the way a descender would.
 * The letters are tracked to match the display style in the app's type scale.
 */
function lockup({ ink, fill }) {
  const font = loadTrueType(FONT);
  const gid = (char) => font.glyphId(char.codePointAt(0));
  const cap = font.bounds(gid('H')).yMax;
  const layout = layoutText(font, 'Kitefold', { letterSpacing: -40 });

  const wordTop = Math.max(...layout.glyphs.map((glyph) => font.bounds(glyph.gid).yMax));
  const wordBottom = Math.min(...layout.glyphs.map((glyph) => font.bounds(glyph.gid).yMin));
  const markSize = cap * 1.65;
  const gap = cap * 0.22;
  const pad = cap * 0.25;

  const baseline = pad + Math.max(wordTop, cap / 2 + markSize / 2);
  const markY = baseline - cap / 2 - markSize / 2 + cap * 0.06;
  const width = pad + markSize + gap + layout.width + pad;
  const height = Math.max(baseline - wordBottom, markY + markSize) + pad;

  // Font units are large; scaling the viewBox to a 96px-high image keeps the numbers
  // readable and the default render size sensible.
  const scale = 96 / height;
  const shapes = markShapes({ x: pad * scale, y: markY * scale, size: markSize * scale });
  const text = textPathData(layout, {
    x: (pad + markSize + gap) * scale,
    y: baseline * scale,
    scale,
  });
  const w = (width * scale).toFixed(1);
  const h = (height * scale).toFixed(1);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="title">
<title id="title">Kitefold</title>
${markSvgPaths(shapes, { ink, fill })}
<path fill="${ink}" d="${text}"/>
</svg>
`;
}

/* --------------------------------------------------------------- animation ---- */

/**
 * The geometry the launch animation folds along, as fractions of the mark's box.
 *
 * Each flap hinges on the kite's outer edge it was folded across — which is what happens
 * to the sheet — so the animation needs where that edge is and which way it runs. Written
 * out rather than recomputed in TypeScript, because the second copy of this geometry is
 * the one that would drift.
 */
function animationGeometry() {
  const unit = markShapes({ x: 0, y: 0, size: 1 });
  const [top, right, bottom, left] = unit.outline;

  // The angle that rotates "down" onto the hinge's direction, in React Native's
  // clockwise-positive degrees, so `rotate(angle) · rotateY(fold) · rotate(-angle)` turns
  // a flap about that edge.
  const hinge = (from, to) => {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    return {
      pivot: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2],
      degrees: (Math.atan2(-dx, dy) * 180) / Math.PI,
    };
  };

  const f = (n) => Number(n.toFixed(4));
  const point = ([x, y]) => `[${f(x)}, ${f(y)}]`;
  const leftHinge = hinge(left, bottom);
  const rightHinge = hinge(right, bottom);

  return `// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0
//
// GENERATED FILE — DO NOT EDIT.
// Source: scripts/brand/mark.mjs   Regenerate: npm run icons:gen

/**
 * Where the mark's parts hinge, as fractions of its square box.
 *
 * A flap folds about the kite's outer edge it was creased along; the tail swings from the
 * kite's bottom point. \`degrees\` is the clockwise rotation that lays the vertical axis
 * along the hinge, so rotating a flap about its hinge is
 * \`rotate(degrees) · rotateY(fold) · rotate(-degrees)\` with the pivot as the origin.
 */
export const MARK_GEOMETRY = {
  top: ${point(top)},
  right: ${point(right)},
  bottom: ${point(bottom)},
  left: ${point(left)},
  flapLeft: { pivot: ${point(leftHinge.pivot)}, degrees: ${f(leftHinge.degrees)} },
  flapRight: { pivot: ${point(rightHinge.pivot)}, degrees: ${f(rightHinge.degrees)} },
  /** The kite's own height as a fraction of the box. */
  kiteHeight: ${f(unit.kiteHeight)},
} as const;
`;
}

/* ------------------------------------------------------------------- write ---- */

const GENERATED_XML = `<!--
  Copyright (c) 2026 Owais Khan
  Licensed under the Apache License, Version 2.0

  GENERATED by scripts/gen-app-icons.mjs from scripts/brand/mark.mjs - do not edit.
  Regenerate: npm run icons:gen
-->
`;

const text = (string) => Buffer.from(string, 'utf8');

const outputs = [
  // iOS, light: opaque, full bleed. The system applies its own mask.
  ['assets/icon.png', icon({ size: 1024, background: palette.amber, colourway: ON_AMBER })],
  // iOS, dark: transparent, so the system's dark backdrop shows through as it does for
  // every other dark icon on the device.
  ['assets/icon-dark.png', icon({ size: 1024, background: null, colourway: ON_DARK })],
  // iOS, tinted: greyscale on transparent; the system supplies the colour.
  ['assets/icon-tinted.png', icon({ size: 1024, background: null, colourway: TINTED })],
  // Android adaptive foreground, on the amber the manifest paints behind it.
  ['assets/adaptive-icon.png', adaptiveIcon({ size: 1024, colourway: ON_AMBER })],
  // Android themed icons: a single-colour silhouette, tinted by the launcher.
  [
    'assets/adaptive-icon-monochrome.png',
    adaptiveIcon({ size: 1024, colourway: MASK, overrides: SMALL }),
  ],
  // Splash marks, one per scheme, on the canvas colour app.json paints behind them.
  ['assets/splash-icon.png', splash({ size: 1024, colourway: ON_CREAM })],
  ['assets/splash-icon-dark.png', splash({ size: 1024, colourway: ON_DARK })],
  [
    'assets/favicon.png',
    icon({ size: 96, background: palette.amber, colourway: ON_AMBER, box: 0.74, overrides: SMALL }),
  ],
  // Play refuses a listing without these two, at exactly these sizes.
  ['store/play/icon-512.png', icon({ size: 512, background: palette.amber, colourway: ON_AMBER })],
  ['store/play/feature-graphic.png', featureGraphic({ width: 1024, height: 500 })],
  // The logo as a designer would hand it over: the mark alone, and the lockup, per scheme.
  ['assets/brand/kitefold-mark-light.svg', text(markSvg({ size: 512, ...ON_CREAM }))],
  ['assets/brand/kitefold-mark-dark.svg', text(markSvg({ size: 512, ...ON_DARK }))],
  ['assets/brand/kitefold-lockup-light.svg', text(lockup(ON_CREAM))],
  ['assets/brand/kitefold-lockup-dark.svg', text(lockup(ON_DARK))],
  // The Android notification glyph, copied into the project by withConverterCoreAndroid.
  [
    'native/android/res/drawable/ic_stat_converter.xml',
    text(markAndroidVector({ header: GENERATED_XML })),
  ],
  // What the launch animation folds along.
  ['src/generated/markGeometry.ts', text(animationGeometry())],
];

// The template layers the app draws with: one file per part, at the three densities
// React Native picks between. The base size is generous because the launch animation
// shows the mark at 180 points on a 3x screen.
for (const part of ['face', 'flapLeft', 'flapRight', 'tail']) {
  const name = part.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  for (const [suffix, scale] of [
    ['', 1],
    ['@2x', 2],
    ['@3x', 3],
  ]) {
    outputs.push([`assets/brand/mark-${name}${suffix}.png`, layer({ size: 256 * scale, part })]);
  }
}

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
    console.error(`\n${stale} brand asset(s) out of date. Run: npm run icons:gen`);
    process.exit(1);
  }
  console.log('generated brand assets are up to date');
}
