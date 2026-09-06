// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Glyph outlines from a TrueType font, so the wordmark can be set in Manrope as paths.
 *
 * The lockup goes into places that cannot load a font: a README on GitHub, a store page,
 * a document. Text in an SVG there falls back to whatever the reader has installed, which
 * is never Manrope. Outlines do not fall back. They are read straight from the same font
 * files the app ships, at generation time, so the wordmark is set in exactly the face the
 * app's headings are set in — and rather than checking in a path somebody once traced, it
 * is regenerated from the font whenever the icons are.
 *
 * Only what the wordmark needs is implemented: `cmap` to find a glyph, `loca` and `glyf`
 * for its outline, `hmtx` for its advance. Kerning is applied by hand in the lockup, the
 * way any wordmark is spaced, rather than by parsing `GPOS`.
 */

import { readFileSync } from 'node:fs';

/** Loads a font with TrueType outlines. Fonts with CFF outlines are refused. */
export function loadTrueType(path) {
  const bytes = readFileSync(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const tables = new Map();
  const count = view.getUint16(4);
  for (let i = 0; i < count; i += 1) {
    const at = 12 + i * 16;
    tables.set(bytes.toString('latin1', at, at + 4), view.getUint32(at + 8));
  }
  const table = (tag) => {
    const offset = tables.get(tag);
    if (offset === undefined) {
      throw new Error(`${path}: no ${tag} table. Only fonts with TrueType outlines are supported.`);
    }
    return offset;
  };

  const head = table('head');
  const unitsPerEm = view.getUint16(head + 18);
  const longOffsets = view.getInt16(head + 50) === 1;
  const numGlyphs = view.getUint16(table('maxp') + 4);
  const hhea = table('hhea');
  const ascender = view.getInt16(hhea + 4);
  const descender = view.getInt16(hhea + 6);
  const metricCount = view.getUint16(hhea + 34);
  const hmtx = table('hmtx');
  const loca = table('loca');
  const glyf = table('glyf');
  const glyphId = parseCmap(view, table('cmap'));

  const locate = (gid) => {
    if (gid >= numGlyphs) throw new Error(`Glyph ${gid} is out of range.`);
    return longOffsets
      ? [view.getUint32(loca + gid * 4), view.getUint32(loca + gid * 4 + 4)]
      : [view.getUint16(loca + gid * 2) * 2, view.getUint16(loca + gid * 2 + 2) * 2];
  };

  const advance = (gid) => view.getUint16(hmtx + Math.min(gid, metricCount - 1) * 4);

  function outline(gid, depth = 0) {
    const [start, end] = locate(gid);
    if (end <= start) return []; // no contours: a space
    const at = glyf + start;
    const contourCount = view.getInt16(at);
    return contourCount >= 0 ? simpleGlyph(at, contourCount) : compositeGlyph(at, depth);
  }

  function simpleGlyph(at, contourCount) {
    let p = at + 10;
    const ends = [];
    for (let i = 0; i < contourCount; i += 1) {
      ends.push(view.getUint16(p));
      p += 2;
    }
    const pointCount = contourCount === 0 ? 0 : ends[contourCount - 1] + 1;
    const instructionLength = view.getUint16(p);
    p += 2 + instructionLength;

    const flags = new Uint8Array(pointCount);
    for (let i = 0; i < pointCount;) {
      const flag = bytes[p];
      p += 1;
      flags[i] = flag;
      i += 1;
      if (flag & 0x08) {
        let repeat = bytes[p];
        p += 1;
        while (repeat > 0 && i < pointCount) {
          flags[i] = flag;
          i += 1;
          repeat -= 1;
        }
      }
    }

    const xs = new Array(pointCount);
    const ys = new Array(pointCount);
    let x = 0;
    for (let i = 0; i < pointCount; i += 1) {
      const flag = flags[i];
      if (flag & 0x02) {
        const d = bytes[p];
        p += 1;
        x += flag & 0x10 ? d : -d;
      } else if (!(flag & 0x10)) {
        x += view.getInt16(p);
        p += 2;
      }
      xs[i] = x;
    }
    let y = 0;
    for (let i = 0; i < pointCount; i += 1) {
      const flag = flags[i];
      if (flag & 0x04) {
        const d = bytes[p];
        p += 1;
        y += flag & 0x20 ? d : -d;
      } else if (!(flag & 0x20)) {
        y += view.getInt16(p);
        p += 2;
      }
      ys[i] = y;
    }

    const contours = [];
    let first = 0;
    for (const last of ends) {
      const points = [];
      for (let i = first; i <= last; i += 1)
        points.push({ x: xs[i], y: ys[i], on: (flags[i] & 0x01) !== 0 });
      contours.push(points);
      first = last + 1;
    }
    return contours;
  }

  function compositeGlyph(at, depth) {
    if (depth > 4) throw new Error('Composite glyph nesting is deeper than any real font needs.');
    const contours = [];
    let p = at + 10;
    for (;;) {
      const flags = view.getUint16(p);
      const index = view.getUint16(p + 2);
      p += 4;

      let dx;
      let dy;
      if (flags & 0x0001) {
        dx = view.getInt16(p);
        dy = view.getInt16(p + 2);
        p += 4;
      } else {
        dx = view.getInt8(p);
        dy = view.getInt8(p + 1);
        p += 2;
      }
      // Placement by matching point indices is legal and unheard of in a text face.
      if (!(flags & 0x0002)) {
        dx = 0;
        dy = 0;
      }

      let a = 1;
      let b = 0;
      let c = 0;
      let d = 1;
      const f2dot14 = (o) => view.getInt16(o) / 16384;
      if (flags & 0x0008) {
        a = f2dot14(p);
        d = a;
        p += 2;
      } else if (flags & 0x0040) {
        a = f2dot14(p);
        d = f2dot14(p + 2);
        p += 4;
      } else if (flags & 0x0080) {
        a = f2dot14(p);
        b = f2dot14(p + 2);
        c = f2dot14(p + 4);
        d = f2dot14(p + 6);
        p += 8;
      }

      for (const contour of outline(index, depth + 1)) {
        contours.push(
          contour.map((pt) => ({
            x: a * pt.x + c * pt.y + dx,
            y: b * pt.x + d * pt.y + dy,
            on: pt.on,
          })),
        );
      }
      if (!(flags & 0x0020)) break;
    }
    return contours;
  }

  const pathCache = new Map();

  return {
    unitsPerEm,
    ascender,
    descender,
    glyphId,
    advance,
    /** Path commands in font units, y upward: `['M',x,y]`, `['L',x,y]`, `['Q',cx,cy,x,y]`, `['Z']`. */
    path(gid) {
      if (!pathCache.has(gid)) pathCache.set(gid, outline(gid).flatMap(contourToPath));
      return pathCache.get(gid);
    },
    /** The bounding box of a glyph's on-curve and control points, in font units. */
    bounds(gid) {
      const points = outline(gid).flat();
      return {
        xMin: Math.min(...points.map((p) => p.x)),
        xMax: Math.max(...points.map((p) => p.x)),
        yMin: Math.min(...points.map((p) => p.y)),
        yMax: Math.max(...points.map((p) => p.y)),
      };
    },
  };
}

function parseCmap(view, base) {
  const count = view.getUint16(base + 2);
  let best = null;
  for (let i = 0; i < count; i += 1) {
    const at = base + 4 + i * 8;
    const platform = view.getUint16(at);
    const offset = view.getUint32(at + 4);
    const format = view.getUint16(base + offset);
    const score = format === 12 ? 2 : format === 4 ? 1 : 0;
    if ((platform === 3 || platform === 0) && score > (best?.score ?? 0))
      best = { score, format, at: base + offset };
  }
  if (!best) throw new Error('No usable cmap subtable (format 4 or 12) in the font.');
  return best.format === 12 ? cmapFormat12(view, best.at) : cmapFormat4(view, best.at);
}

function cmapFormat4(view, at) {
  const segmentsX2 = view.getUint16(at + 6);
  const segments = segmentsX2 / 2;
  const ends = at + 14;
  const starts = ends + segmentsX2 + 2;
  const deltas = starts + segmentsX2;
  const ranges = deltas + segmentsX2;
  return (code) => {
    for (let i = 0; i < segments; i += 1) {
      if (code > view.getUint16(ends + i * 2)) continue;
      const start = view.getUint16(starts + i * 2);
      if (code < start) return 0;
      const delta = view.getInt16(deltas + i * 2);
      const rangeOffset = view.getUint16(ranges + i * 2);
      if (rangeOffset === 0) return (code + delta) & 0xffff;
      const glyph = view.getUint16(ranges + i * 2 + rangeOffset + (code - start) * 2);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
}

function cmapFormat12(view, at) {
  const groups = view.getUint32(at + 12);
  return (code) => {
    for (let i = 0; i < groups; i += 1) {
      const g = at + 16 + i * 12;
      const start = view.getUint32(g);
      const end = view.getUint32(g + 4);
      if (code >= start && code <= end) return view.getUint32(g + 8) + (code - start);
    }
    return 0;
  };
}

const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * TrueType contours are quadratic splines in which two consecutive off-curve points
 * imply an on-curve point midway between them. This makes those points explicit and
 * returns ordinary path commands.
 */
function contourToPath(points) {
  const n = points.length;
  if (n === 0) return [];

  const firstOn = points.findIndex((p) => p.on);
  const sequence =
    firstOn === -1 ? points : [...points.slice(firstOn), ...points.slice(0, firstOn)];
  const start = firstOn === -1 ? midpoint(points[n - 1], points[0]) : sequence[0];
  const rest = firstOn === -1 ? sequence : sequence.slice(1);

  const commands = [['M', start.x, start.y]];
  let control = null;
  for (const point of rest) {
    if (point.on) {
      commands.push(
        control ? ['Q', control.x, control.y, point.x, point.y] : ['L', point.x, point.y],
      );
      control = null;
    } else if (control) {
      const m = midpoint(control, point);
      commands.push(['Q', control.x, control.y, m.x, m.y]);
      control = point;
    } else {
      control = point;
    }
  }
  if (control) commands.push(['Q', control.x, control.y, start.x, start.y]);
  commands.push(['Z']);
  return commands;
}

/**
 * Sets a line of text. `letterSpacing` and the `kerning` pairs are in font units;
 * a pair is keyed by its two characters, `{ fo: -20 }`.
 */
export function layoutText(font, text, { letterSpacing = 0, kerning = {} } = {}) {
  const glyphs = [];
  let pen = 0;
  let previous = null;
  for (const char of text) {
    const gid = font.glyphId(char.codePointAt(0));
    if (gid === 0) throw new Error(`The font has no glyph for "${char}".`);
    if (previous !== null) pen += kerning[previous + char] ?? 0;
    glyphs.push({ char, gid, x: pen, path: font.path(gid) });
    pen += font.advance(gid) + letterSpacing;
    previous = char;
  }
  return { glyphs, width: pen - letterSpacing };
}

const number = (n) => {
  const s = n.toFixed(2);
  return s.replace(/\.?0+$/, '') || '0';
};

/**
 * A laid-out line as SVG path data, placed with its baseline's origin at `(x, y)` in a
 * y-down coordinate system and scaled by `scale`.
 */
export function textPathData(layout, { x = 0, y = 0, scale = 1 } = {}) {
  const parts = [];
  for (const glyph of layout.glyphs) {
    const tx = (gx) => number(x + (glyph.x + gx) * scale);
    const ty = (gy) => number(y - gy * scale);
    for (const command of glyph.path) {
      switch (command[0]) {
        case 'M':
          parts.push(`M${tx(command[1])},${ty(command[2])}`);
          break;
        case 'L':
          parts.push(`L${tx(command[1])},${ty(command[2])}`);
          break;
        case 'Q':
          parts.push(`Q${tx(command[1])},${ty(command[2])} ${tx(command[3])},${ty(command[4])}`);
          break;
        default:
          parts.push('Z');
      }
    }
  }
  return parts.join('');
}

/**
 * The same line flattened to polygons, for the rasteriser. Each contour becomes a closed
 * polyline; curves are split into `segments` straight pieces.
 */
export function textContours(layout, { x = 0, y = 0, scale = 1, segments = 8 } = {}) {
  const contours = [];
  for (const glyph of layout.glyphs) {
    const tx = (gx) => x + (glyph.x + gx) * scale;
    const ty = (gy) => y - gy * scale;
    let current = null;
    let cursor = null;
    for (const command of glyph.path) {
      if (command[0] === 'M') {
        current = [[tx(command[1]), ty(command[2])]];
        cursor = [command[1], command[2]];
        contours.push(current);
      } else if (command[0] === 'L') {
        current.push([tx(command[1]), ty(command[2])]);
        cursor = [command[1], command[2]];
      } else if (command[0] === 'Q') {
        const [, cx, cy, ex, ey] = command;
        for (let i = 1; i <= segments; i += 1) {
          const t = i / segments;
          const u = 1 - t;
          const px = u * u * cursor[0] + 2 * u * t * cx + t * t * ex;
          const py = u * u * cursor[1] + 2 * u * t * cy + t * t * ey;
          current.push([tx(px), ty(py)]);
        }
        cursor = [ex, ey];
      }
    }
  }
  return contours;
}
