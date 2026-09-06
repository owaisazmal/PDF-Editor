// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The Kitefold mark, as geometry rather than artwork.
 *
 * The mark is an origami kite base: the fold that turns a square sheet into a kite. Fold
 * two adjacent edges of a square onto its diagonal and what is left is a kite made of
 * three triangles — the top of the sheet, still flat, and the two flaps folded in below
 * it, meeting along the spine. Nothing is added and nothing is cut away; the same sheet
 * is simply folded into another shape. That is the product drawn once: a file goes in,
 * the same file comes out in a different form, and it never leaves the hands that folded
 * it. The kite leans forward and trails a tail, because a kite with neither is a diamond.
 *
 * Everything is expressed in a local frame where the kite is one unit tall and centred on
 * the origin; it is tilted there, and the whole composition — kite and tail — is then
 * normalised into a unit square. Consumers place that square wherever they need it at
 * whatever size, and get polygons and a stroke back in their own coordinates. The same
 * numbers therefore draw the app icon, the splash mark, the in-app logo, the SVG lockup
 * and the Android notification glyph, and none of the five can drift from the others.
 */

const DEGREES = Math.PI / 180;

/** The proportions. Fractions of the kite's height unless stated otherwise. */
export const PROPORTIONS = {
  /**
   * How far down the kite the cross-spar sits, measured from the top point. A square
   * folds to 0.29; this is a little broader in the shoulder, which is what makes the top
   * corner a right angle and the whole thing read as a kite rather than a spearhead.
   */
  spar: 0.34,
  /** Half the width at the spar. Equal to `spar`, so the top corner is exactly square. */
  halfWidth: 0.34,
  /** Forward lean, in degrees clockwise. */
  tilt: 18,
  /** Width of the creases: the gaps between the three triangles. */
  crease: 0.05,
  /**
   * Width of the tail. A little heavier than a crease, because a positive stroke reads
   * lighter than the same width of negative space.
   */
  tailWidth: 0.06,
  /**
   * The tail, as a cubic Bézier from the bottom point, in the frame before the tilt. It
   * leaves along the spine and trails away behind the lean in one easy arc; anything
   * that curled back on itself read as a hook.
   */
  tail: [
    [0, 0.5],
    [0, 0.66],
    [-0.05, 0.78],
    [-0.2, 0.93],
  ],
};

const rotate = ([x, y], degrees) => {
  const c = Math.cos(degrees * DEGREES);
  const s = Math.sin(degrees * DEGREES);
  return [x * c - y * s, x * s + y * c];
};

/**
 * Moves each edge of a polygon inward by its own distance and returns the new corners.
 *
 * This is how the creases are cut: each triangle keeps its outer edges exactly where they
 * were and gives up half a crease along the edges it shares with a neighbour, so the gap
 * between two triangles is one crease wide and the silhouette of the kite is untouched.
 */
export function insetPolygon(points, insets) {
  const n = points.length;
  let area = 0;
  for (let i = 0; i < n; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  // The interior lies to the left of every edge when the signed area is positive.
  const sign = area > 0 ? 1 : -1;

  const lines = points.map((p, i) => {
    const q = points[(i + 1) % n];
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const length = Math.hypot(ex, ey);
    const nx = (-ey / length) * sign;
    const ny = (ex / length) * sign;
    return { nx, ny, c: nx * p[0] + ny * p[1] + insets[i] };
  });

  return points.map((p, i) => {
    const a = lines[(i - 1 + n) % n];
    const b = lines[i];
    const det = a.nx * b.ny - a.ny * b.nx;
    if (Math.abs(det) < 1e-12) return [p[0] + b.nx * insets[i], p[1] + b.ny * insets[i]];
    return [(a.c * b.ny - b.c * a.ny) / det, (a.nx * b.c - b.nx * a.c) / det];
  });
}

function cubicAt([p0, p1, p2, p3], t) {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return [
    w0 * p0[0] + w1 * p1[0] + w2 * p2[0] + w3 * p3[0],
    w0 * p0[1] + w1 * p1[1] + w2 * p2[1] + w3 * p3[1],
  ];
}

export const flattenCubic = (bezier, segments = 32) =>
  Array.from({ length: segments + 1 }, (_, i) => cubicAt(bezier, i / segments));

/** The mark in a unit square, `{ x: 0..1, y: 0..1 }`, y downward. Built once per set of proportions. */
function build(overrides = {}) {
  const { spar, halfWidth, tilt, crease, tailWidth, tail } = { ...PROPORTIONS, ...overrides };

  // The kite before it leans: top, left and right shoulders, the spine's meeting point,
  // and the bottom.
  const sparY = -0.5 + spar;
  const top = [0, -0.5];
  const left = [-halfWidth, sparY];
  const right = [halfWidth, sparY];
  const middle = [0, sparY];
  const bottom = [0, 0.5];
  const half = crease / 2;

  const local = {
    face: insetPolygon([top, right, left], [0, half, 0]),
    flapLeft: insetPolygon([left, middle, bottom], [half, half, 0]),
    flapRight: insetPolygon([middle, right, bottom], [half, 0, half]),
    outline: [top, right, bottom, left],
    tailBezier: tail,
  };

  const lean = (points) => points.map((p) => rotate(p, tilt));
  const tilted = Object.fromEntries(Object.entries(local).map(([key, pts]) => [key, lean(pts)]));
  const tailPolyline = flattenCubic(tilted.tailBezier);

  // Fit the whole composition into the unit square, centred.
  const extent = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const include = ([x, y], pad = 0) => {
    extent.minX = Math.min(extent.minX, x - pad);
    extent.minY = Math.min(extent.minY, y - pad);
    extent.maxX = Math.max(extent.maxX, x + pad);
    extent.maxY = Math.max(extent.maxY, y + pad);
  };
  tilted.outline.forEach((p) => include(p));
  tailPolyline.forEach((p) => include(p, tailWidth / 2));

  const scale = 1 / Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY);
  const cx = (extent.minX + extent.maxX) / 2;
  const cy = (extent.minY + extent.maxY) / 2;
  const normalise = (points) =>
    points.map(([x, y]) => [(x - cx) * scale + 0.5, (y - cy) * scale + 0.5]);

  return {
    face: normalise(tilted.face),
    flapLeft: normalise(tilted.flapLeft),
    flapRight: normalise(tilted.flapRight),
    outline: normalise(tilted.outline),
    tailBezier: normalise(tilted.tailBezier),
    tailPolyline: normalise(tailPolyline),
    tailWidth: tailWidth * scale,
    crease: crease * scale,
    /** The kite's own height as a fraction of the unit square. */
    kiteHeight: scale,
  };
}

const cache = new Map();

/**
 * The mark placed at `{ x, y }` with the unit square scaled to `size`, in the caller's
 * coordinates. `crease` and `tailWidth` may be overridden for very small renderings, where
 * a hairline crease would vanish and the tail would thin to nothing.
 */
export function markShapes({ x = 0, y = 0, size = 1, ...overrides } = {}) {
  const key = JSON.stringify(overrides);
  if (!cache.has(key)) cache.set(key, build(overrides));
  const unit = cache.get(key);

  const place = (points) => points.map(([px, py]) => [x + px * size, y + py * size]);
  return {
    face: place(unit.face),
    flapLeft: place(unit.flapLeft),
    flapRight: place(unit.flapRight),
    outline: place(unit.outline),
    tailBezier: place(unit.tailBezier),
    tailPolyline: place(unit.tailPolyline),
    tailWidth: unit.tailWidth * size,
    crease: unit.crease * size,
    kiteHeight: unit.kiteHeight * size,
  };
}

/**
 * The mark as raster layers: `ink` draws the face and the tail, `fill` draws the two
 * flaps. Pass the same colour for both to draw it in one colour; the creases survive as
 * gaps either way.
 */
export function markLayers(shapes, { ink, fill }) {
  return [
    {
      color: fill,
      shapes: [
        { kind: 'polygon', points: shapes.flapLeft },
        { kind: 'polygon', points: shapes.flapRight },
      ],
    },
    {
      color: ink,
      shapes: [
        { kind: 'polygon', points: shapes.face },
        { kind: 'stroke', points: shapes.tailPolyline, width: shapes.tailWidth },
      ],
    },
  ];
}

/* ------------------------------------------------------------------- vector ---- */

const number = (n) => {
  const s = n.toFixed(3);
  return s.replace(/\.?0+$/, '') || '0';
};

const polygonPath = (points) =>
  `M${points.map(([x, y]) => `${number(x)},${number(y)}`).join('L')}Z`;

const bezierPath = ([p0, p1, p2, p3]) =>
  `M${number(p0[0])},${number(p0[1])}C${[p1, p2, p3].map(([x, y]) => `${number(x)},${number(y)}`).join(' ')}`;

/** SVG path elements for the mark, in drawing order. */
export function markSvgPaths(shapes, { ink, fill }) {
  return [
    `<path fill="${fill}" d="${polygonPath(shapes.flapLeft)}${polygonPath(shapes.flapRight)}"/>`,
    `<path fill="${ink}" d="${polygonPath(shapes.face)}"/>`,
    `<path fill="none" stroke="${ink}" stroke-width="${number(shapes.tailWidth)}" stroke-linecap="round" d="${bezierPath(shapes.tailBezier)}"/>`,
  ].join('\n');
}

/** A standalone SVG of the mark alone, `size` units square. */
export function markSvg({ size, ink, fill, title = 'Kitefold' }) {
  const shapes = markShapes({ x: 0, y: 0, size });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-labelledby="title">
<title id="title">${title}</title>
${markSvgPaths(shapes, { ink, fill })}
</svg>
`;
}

/**
 * The Android notification glyph, as a vector drawable.
 *
 * Pure white, because a notification icon is a mask: Android discards the colour and keeps
 * the alpha. The creases and the tail are drawn heavier than anywhere else, since this is
 * rendered at 24dp and a crease at the mark's true weight would be less than a pixel.
 */
export function markAndroidVector({ header = '' } = {}) {
  const shapes = markShapes({ x: 2, y: 2, size: 20, crease: 0.1, tailWidth: 0.11 });
  return `<?xml version="1.0" encoding="utf-8"?>
${header}<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="${polygonPath(shapes.flapLeft)}${polygonPath(shapes.flapRight)}${polygonPath(shapes.face)}" />
    <path
        android:strokeColor="#FFFFFFFF"
        android:strokeWidth="${number(shapes.tailWidth)}"
        android:strokeLineCap="round"
        android:pathData="${bezierPath(shapes.tailBezier)}" />
</vector>
`;
}
