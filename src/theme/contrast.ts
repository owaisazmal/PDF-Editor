// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * WCAG 2.1 relative luminance and contrast ratio.
 *
 * Used by the token contrast test and by the licence/design CI job. Kept dependency
 * free and side-effect free so it can run in any environment.
 *
 * Reference: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */

export type Rgb = { r: number; g: number; b: number };

const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Parses `#RGB` or `#RRGGBB` into 0–255 channels. */
export function parseHex(value: string): Rgb {
  if (!HEX_PATTERN.test(value)) {
    throw new Error(
      `Expected an opaque hex colour like #RRGGBB, received "${value}". ` +
        'Translucent colours cannot be contrast-checked without a known backdrop.',
    );
  }
  const hex = value.slice(1);
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

/** Linearises one 0–255 sRGB channel. */
function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(color: string | Rgb): number {
  const { r, g, b } = typeof color === 'string' ? parseHex(color) : color;
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/** WCAG contrast ratio between two opaque colours. Always >= 1, order independent. */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Contrast ratio rounded the way it is conventionally reported. */
export function contrastRatioRounded(a: string | Rgb, b: string | Rgb): number {
  return Math.round(contrastRatio(a, b) * 100) / 100;
}
