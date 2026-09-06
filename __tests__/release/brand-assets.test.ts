// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The artwork a build and a listing are refused without, and the numbers that tie it to
 * the rest of the app.
 *
 * Every file here is generated from one piece of geometry and the token palette, and
 * `npm run icons:check` says whether the files are current. What that check cannot say is
 * whether app.json points at them, whether the colours app.json paints behind them are the
 * palette's, or whether the splash mark is drawn at the size the launch animation takes
 * over at. A wrong answer to any of those is not a build error; it is a seam somebody sees.
 */

import fs from 'node:fs';
import path from 'node:path';

import config from '../../app.json';
import { MARK_GEOMETRY } from '@/generated/markGeometry';
import { SPLASH_MARK_SIZE } from '@/features/launch/splash';
import { colors, palette } from '@/theme/tokens';

const root = path.join(__dirname, '..', '..');
const { expo } = config;

const exists = (relative: string) => fs.existsSync(path.join(root, relative));

/** Width and height from the PNG header, so a size is checked rather than assumed. */
function pngSize(relative: string): [number, number] {
  const header = Buffer.alloc(24);
  const file = fs.openSync(path.join(root, relative), 'r');
  fs.readSync(file, header, 0, 24, 0);
  fs.closeSync(file);
  return [header.readUInt32BE(16), header.readUInt32BE(20)];
}

type SplashConfig = {
  image: string;
  imageWidth: number;
  backgroundColor: string;
  dark: { image: string; backgroundColor: string };
};

const splash = (expo.plugins as unknown[]).find(
  (entry): entry is [string, SplashConfig] =>
    Array.isArray(entry) && entry[0] === 'expo-splash-screen',
)?.[1];

describe('the app icon', () => {
  it('has a file for each iOS appearance', () => {
    for (const appearance of ['light', 'dark', 'tinted'] as const) {
      expect(exists(expo.ios.icon[appearance])).toBe(true);
    }
  });

  it('is 1024 pixels square, which is the one size the stores accept', () => {
    expect(pngSize(expo.ios.icon.light)).toEqual([1024, 1024]);
    expect(pngSize(expo.android.adaptiveIcon.foregroundImage)).toEqual([1024, 1024]);
  });

  it('gives Android a monochrome layer that is not the coloured foreground', () => {
    // The same file in both slots was the previous state, and it rendered a themed icon
    // as a solid blob: Android keeps only the alpha, and the coloured foreground is opaque
    // everywhere the mark is.
    const { foregroundImage, monochromeImage } = expo.android.adaptiveIcon;
    expect(monochromeImage).not.toBe(foregroundImage);
    expect(exists(monochromeImage)).toBe(true);
  });

  it('is painted on the accent fill', () => {
    expect(expo.android.adaptiveIcon.backgroundColor).toBe(palette.amber);
  });
});

describe('the splash screen', () => {
  it('is configured', () => {
    expect(splash).toBeDefined();
  });

  it('draws a mark for each scheme on that scheme’s canvas', () => {
    expect(splash!.backgroundColor).toBe(colors.light.bgCanvas);
    expect(splash!.dark.backgroundColor).toBe(colors.dark.bgCanvas);
    expect(splash!.image).not.toBe(splash!.dark.image);
    expect(exists(splash!.image)).toBe(true);
    expect(exists(splash!.dark.image)).toBe(true);
  });

  it('shows the mark at the size the launch animation takes over at', () => {
    expect(splash!.imageWidth).toBe(SPLASH_MARK_SIZE);
  });
});

describe('the Play Store artwork', () => {
  it('is at exactly the sizes Play refuses anything else at', () => {
    expect(pngSize('store/play/icon-512.png')).toEqual([512, 512]);
    expect(pngSize('store/play/feature-graphic.png')).toEqual([1024, 500]);
  });
});

describe('the logo files', () => {
  it.each(['light', 'dark'])('ship the mark and the lockup for the %s scheme', (scheme) => {
    expect(exists(`assets/brand/kitefold-mark-${scheme}.svg`)).toBe(true);
    expect(exists(`assets/brand/kitefold-lockup-${scheme}.svg`)).toBe(true);
  });

  it('set the wordmark as outlines rather than text', () => {
    // Text would fall back to whatever font the reader has, which is never Manrope.
    const svg = fs.readFileSync(path.join(root, 'assets/brand/kitefold-lockup-light.svg'), 'utf8');
    expect(svg).not.toMatch(/<text/);
    expect(svg).toMatch(/<path/);
  });
});

describe('the geometry the launch animation folds along', () => {
  it('keeps every hinge inside the mark’s box', () => {
    const points = [
      MARK_GEOMETRY.top,
      MARK_GEOMETRY.right,
      MARK_GEOMETRY.bottom,
      MARK_GEOMETRY.left,
      MARK_GEOMETRY.flapLeft.pivot,
      MARK_GEOMETRY.flapRight.pivot,
    ];
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  it('hinges each flap on the edge that runs to the kite’s bottom point', () => {
    // A hinge pivot is the midpoint of its edge, so it lies halfway between a shoulder
    // and the bottom. If the geometry were regenerated wrongly this is where it shows.
    const mid = (a: readonly [number, number], b: readonly [number, number]) => [
      (a[0] + b[0]) / 2,
      (a[1] + b[1]) / 2,
    ];
    expect(MARK_GEOMETRY.flapLeft.pivot[0]).toBeCloseTo(
      mid(MARK_GEOMETRY.left, MARK_GEOMETRY.bottom)[0]!,
      3,
    );
    expect(MARK_GEOMETRY.flapRight.pivot[1]).toBeCloseTo(
      mid(MARK_GEOMETRY.right, MARK_GEOMETRY.bottom)[1]!,
      3,
    );
  });
});
