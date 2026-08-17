// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { contrastRatio, contrastRatioRounded, parseHex } from '@/theme/contrast';
import { CONTRAST_CONTRACT, colors, palette, type ColorSchemeName } from '@/theme/tokens';

const SCHEMES: ColorSchemeName[] = ['light', 'dark'];

describe('contrast maths', () => {
  it('matches the WCAG reference values at the extremes', () => {
    expect(contrastRatioRounded('#000000', '#FFFFFF')).toBe(21);
    expect(contrastRatioRounded('#FFFFFF', '#FFFFFF')).toBe(1);
  });

  it('is order independent', () => {
    expect(contrastRatio('#241708', '#FDFBD4')).toBeCloseTo(contrastRatio('#FDFBD4', '#241708'), 10);
  });

  it('expands three-digit hex', () => {
    expect(parseHex('#FA0')).toEqual(parseHex('#FFAA00'));
  });

  it('refuses translucent colours rather than guessing a backdrop', () => {
    expect(() => parseHex('rgba(36, 23, 8, 0.55)')).toThrow(/hex colour/i);
  });
});

describe('token contrast contract', () => {
  for (const scheme of SCHEMES) {
    describe(scheme, () => {
      for (const { fg, bg, min } of CONTRAST_CONTRACT) {
        it(`${fg} on ${bg} meets ${min}:1`, () => {
          const fgValue = colors[scheme][fg];
          const bgValue = colors[scheme][bg];
          const ratio = contrastRatioRounded(fgValue, bgValue);
          if (ratio < min) {
            throw new Error(
              `${scheme}.${fg} (${fgValue}) on ${scheme}.${bg} (${bgValue}) ` +
                `measures ${ratio}:1, below the required ${min}:1.`,
            );
          }
          expect(ratio).toBeGreaterThanOrEqual(min);
        });
      }
    });
  }
});

describe('the palette constraint that forced a derived token', () => {
  it('confirms the client amber cannot carry text on the cream ground', () => {
    // This is why palette.amberInk exists (decision D4). If a future palette change
    // makes this pass, amberInk can be retired — until then it is load-bearing.
    expect(contrastRatio(palette.amber, palette.cream)).toBeLessThan(4.5);
  });

  it('confirms the derived amber does', () => {
    expect(contrastRatio(palette.amberInk, palette.cream)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps every scheme complete — no role may be missing', () => {
    const lightKeys = Object.keys(colors.light).sort();
    const darkKeys = Object.keys(colors.dark).sort();
    expect(darkKeys).toEqual(lightKeys);
  });
});
