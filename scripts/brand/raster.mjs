// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Draws what the mark is made of — filled polygons and round-capped strokes — into pixels.
 *
 * Coverage is measured by supersampling: each pixel is split into a grid of samples, each
 * sample asks every shape whether it is inside, and the pixel takes the average. The marks
 * are pure geometry with no fine texture, so a 4x4 grid is enough to look clean at every
 * size a store asks for, and the code stays short enough to read in one sitting.
 *
 * Layers composite back to front over an optional flat background. A layer is one colour
 * and any number of shapes; where its shapes overlap they simply union.
 */

import { encodePng } from './png.mjs';

export const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Distance from a point to a line segment. */
export function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Non-zero winding, so a polygon may carry holes as reversed contours. */
export function insidePolygon(x, y, points) {
  let winding = 0;
  for (let i = 0, n = points.length; i < n; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    if (y1 <= y) {
      if (y2 > y && (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) > 0) winding += 1;
    } else if (y2 <= y && (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) < 0) {
      winding -= 1;
    }
  }
  return winding !== 0;
}

function bounds(points, pad = 0) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/**
 * A shape is `{ kind: 'polygon', points }` or `{ kind: 'stroke', points, width }`; a
 * stroke is a polyline drawn with round caps and joins. `contours` polygons — arrays of
 * point arrays — draw as one shape under the non-zero rule, which is how glyphs carry holes.
 */
function prepare(shape) {
  if (shape.kind === 'polygon') {
    const box = bounds(shape.points);
    return { box, hit: (x, y) => insidePolygon(x, y, shape.points) };
  }
  if (shape.kind === 'contours') {
    const box = bounds(shape.contours.flat());
    return {
      box,
      hit: (x, y) => {
        let winding = 0;
        for (const contour of shape.contours) {
          for (let i = 0, n = contour.length; i < n; i += 1) {
            const [x1, y1] = contour[i];
            const [x2, y2] = contour[(i + 1) % n];
            if (y1 <= y) {
              if (y2 > y && (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) > 0) winding += 1;
            } else if (y2 <= y && (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) < 0) {
              winding -= 1;
            }
          }
        }
        return winding !== 0;
      },
    };
  }
  if (shape.kind === 'stroke') {
    const half = shape.width / 2;
    const box = bounds(shape.points, half);
    const pts = shape.points;
    return {
      box,
      hit: (x, y) => {
        for (let i = 0; i + 1 < pts.length; i += 1) {
          if (distanceToSegment(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) <= half)
            return true;
        }
        return false;
      },
    };
  }
  throw new Error(`Unknown shape kind: ${shape.kind}`);
}

/**
 * Renders `layers` — `[{ color: '#RRGGBB', shapes: [...] }]`, back to front — over a flat
 * `background` colour, or over transparency when it is null. Returns a PNG.
 */
export function render({ width, height, background = null, layers, samples = 4 }) {
  const pixels = Buffer.alloc(width * height * 4);
  const backgroundRgb = background ? hexToRgb(background) : null;
  const prepared = layers.map((layer) => ({
    rgb: hexToRgb(layer.color),
    shapes: layer.shapes.map(prepare),
  }));

  // Pixels no shape can reach are written straight from the background, which is most
  // of every icon.
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const layer of prepared) {
    for (const shape of layer.shapes) {
      box.minX = Math.min(box.minX, shape.box.minX);
      box.minY = Math.min(box.minY, shape.box.minY);
      box.maxX = Math.max(box.maxX, shape.box.maxX);
      box.maxY = Math.max(box.maxY, shape.box.maxY);
    }
  }

  const total = samples * samples;
  const coverage = new Float64Array(prepared.length);

  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const outside = px + 1 < box.minX || px > box.maxX || py + 1 < box.minY || py > box.maxY;

      if (!outside) {
        coverage.fill(0);
        for (let sy = 0; sy < samples; sy += 1) {
          for (let sx = 0; sx < samples; sx += 1) {
            const x = px + (sx + 0.5) / samples;
            const y = py + (sy + 0.5) / samples;
            for (let l = 0; l < prepared.length; l += 1) {
              for (const shape of prepared[l].shapes) {
                const b = shape.box;
                if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
                if (shape.hit(x, y)) {
                  coverage[l] += 1;
                  break;
                }
              }
            }
          }
        }
      }

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      if (backgroundRgb) {
        [r, g, b] = backgroundRgb;
        a = 1;
      }
      if (!outside) {
        for (let l = 0; l < prepared.length; l += 1) {
          const alpha = coverage[l] / total;
          if (alpha === 0) continue;
          const [lr, lg, lb] = prepared[l].rgb;
          // Straight-alpha "over": the colour is the coverage-weighted mix, the alpha unions.
          const outA = alpha + a * (1 - alpha);
          r = (lr * alpha + r * a * (1 - alpha)) / outA;
          g = (lg * alpha + g * a * (1 - alpha)) / outA;
          b = (lb * alpha + b * a * (1 - alpha)) / outA;
          a = outA;
        }
      }

      const offset = (py * width + px) * 4;
      pixels[offset] = Math.round(r);
      pixels[offset + 1] = Math.round(g);
      pixels[offset + 2] = Math.round(b);
      pixels[offset + 3] = Math.round(a * 255);
    }
  }

  return encodePng(width, height, pixels);
}
