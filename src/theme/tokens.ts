// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The single source of truth for every colour, size, radius and duration in the app.
 *
 * This is the ONLY file in `src/` permitted to contain a literal colour — the ESLint
 * config fails the build on a hex literal anywhere else. `scripts/gen-tokens.mjs`
 * compiles this file into `Tokens.swift` and `Tokens.kt` so the iOS share extension
 * and the Android share target render in the same system without a second copy of
 * the palette.
 *
 * Contrast: `__tests__/theme/contrast.test.ts` measures every foreground/background
 * pairing declared in `CONTRAST_CONTRACT` below and fails under WCAG AA. Changing a
 * colour here without checking that test is how design systems quietly break.
 *
 * See docs/ARCHITECTURE.md §4.
 */

/**
 * The client palette, verbatim, plus one derived member.
 *
 * `amberInk` (#A85F1E) exists because `amber` (#D47E30) measures 2.92:1 on `cream`
 * and cannot legally carry text. It is the same hue darkened until it clears AA, so
 * the palette's character is preserved and text has somewhere to live. Decision D4.
 */
export const palette = {
  cream: '#FDFBD4',
  amber: '#D47E30',
  amberInk: '#A85F1E',
  sienna: '#8D5A2B',
  umber: '#825E34',
} as const;

/**
 * Colours that become image data rather than user interface.
 *
 * These are written into the pixels of converted files, so they must never vary with
 * the theme: a JPEG exported while the app is in dark mode must not come out with a
 * dark background. They live here because this file owns every colour in the app —
 * but they are deliberately outside the light/dark schemes below.
 */
export const imageDefaults = {
  /**
   * Fill applied when flattening transparency into a format with no alpha channel.
   * White, because a silently black background is the top one-star review in this
   * category. The user can override it per conversion.
   */
  backgroundFill: '#FFFFFF',
} as const;

export type ColorSchemeName = 'light' | 'dark';

/**
 * Semantic colour roles. Components reference these names, never the palette
 * directly, so a role can be re-pointed without touching a component.
 */
export type ColorTokens = {
  /** Page ground. */
  bgCanvas: string;
  /** Cards, sheets, list rows. */
  bgSurface: string;
  /** Surfaces that sit above other surfaces — menus, dialogs. */
  bgRaised: string;
  /** Wells, code blocks, inactive track. */
  bgSunken: string;
  /** Full-screen dim behind a modal. */
  bgScrim: string;

  /** Decorative dividers. Not required to meet 3:1. */
  borderHairline: string;
  /** Card outlines. Decorative. */
  borderDefault: string;
  /** Boundary of an interactive control. Meets 3:1 against its background. */
  borderControl: string;
  /** Keyboard focus ring. Meets 3:1. */
  borderFocus: string;

  /** Body copy and headings. */
  textPrimary: string;
  /** Supporting copy. Meets 4.5:1. */
  textSecondary: string;
  /** Metadata and captions. Meets 4.5:1. */
  textTertiary: string;
  /** Text on the accent fill. */
  textOnAccent: string;
  /** Text on the deep accent (primary button). */
  textOnAccentDeep: string;
  /** Non-interactive control label. Deliberately exempt from AA per WCAG 1.4.3. */
  textDisabled: string;

  /** Large fills, progress tracks, illustration. NOT for text — see amberInk. */
  accentFill: string;
  /** Accent-coloured text, icons, links. Meets 4.5:1. */
  accentInk: string;
  /** Primary button background, and accent glyphs sitting on `accentSoft`. */
  accentDeep: string;
  /**
   * Tinted background for selected or highlighted rows.
   *
   * Text on this surface is `textPrimary`, not `accentInk` — accent-on-accent-tint
   * cannot reach 4.5:1 in either scheme without collapsing the tint into the page
   * ground. Accent glyphs on this surface use `accentDeep`.
   */
  accentSoft: string;

  successInk: string;
  successBg: string;
  warningInk: string;
  warningBg: string;
  dangerInk: string;
  dangerBg: string;

  /** Warm-tinted shadow. Neutral black shadow reads as dirt on a cream ground. */
  shadowColor: string;
};

/**
 * Light. The ground is the client's cream; the browns carry text; the amber is
 * decorative because it cannot pass contrast on this ground.
 */
const light: ColorTokens = {
  bgCanvas: palette.cream,
  bgSurface: '#FFFEF0',
  bgRaised: '#FFFFFF',
  bgSunken: '#F6F2C6',
  bgScrim: 'rgba(36, 23, 8, 0.55)',

  borderHairline: '#E4DCA8',
  borderDefault: '#C9BE86',
  borderControl: palette.sienna,
  borderFocus: palette.amberInk,

  textPrimary: '#241708',
  textSecondary: '#6F5027',
  textTertiary: palette.sienna,
  textOnAccent: '#241708',
  textOnAccentDeep: '#FFFFFF',
  textDisabled: '#A89468',

  accentFill: palette.amber,
  accentInk: palette.amberInk,
  accentDeep: palette.sienna,
  accentSoft: '#F7E7C8',

  successInk: '#35682F',
  successBg: '#E7EFD3',
  warningInk: '#7A5C0F',
  warningBg: '#F5EFC8',
  dangerInk: '#9C3B22',
  dangerBg: '#F8E3D9',

  shadowColor: '#241708',
};

/**
 * Dark, derived to preserve the light theme's hierarchy rather than invert its values.
 *
 * The roles swap: on the deep warm ground the amber finally clears AA and becomes the
 * text accent, while the sienna that carried text in light mode steps back to surfaces
 * and control boundaries. Same palette, same relationships, different jobs.
 */
const dark: ColorTokens = {
  bgCanvas: '#17110A',
  bgSurface: '#211A11',
  bgRaised: '#2C2317',
  bgSunken: '#120D07',
  bgScrim: 'rgba(0, 0, 0, 0.66)',

  borderHairline: '#3A2E1D',
  borderDefault: '#52412A',
  borderControl: '#8A7043',
  borderFocus: palette.amber,

  textPrimary: palette.cream,
  textSecondary: '#D8CFA4',
  textTertiary: '#A99A6E',
  textOnAccent: '#17110A',
  textOnAccentDeep: '#17110A',
  textDisabled: '#6E6142',

  accentFill: palette.amber,
  accentInk: palette.amber,
  accentDeep: palette.amber,
  accentSoft: '#322410',

  successInk: '#A6C77E',
  successBg: '#26301A',
  warningInk: '#D9C173',
  warningBg: '#332B12',
  dangerInk: '#E8A184',
  dangerBg: '#3B2016',

  shadowColor: '#000000',
};

export const colors: Record<ColorSchemeName, ColorTokens> = { light, dark };

/**
 * Pairings the contrast test enforces. `min` is the WCAG AA threshold that applies:
 * 4.5 for body text, 3.0 for large text and non-text UI boundaries.
 *
 * Roles deliberately excluded: `textDisabled` (WCAG 1.4.3 exempts inactive controls),
 * `borderHairline` and `borderDefault` (purely decorative dividers, they convey nothing),
 * and `accentFill` as a foreground (it is a fill; `accentInk` is its text counterpart).
 */
export const CONTRAST_CONTRACT: readonly {
  fg: keyof ColorTokens;
  bg: keyof ColorTokens;
  min: number;
}[] = [
  { fg: 'textPrimary', bg: 'bgCanvas', min: 4.5 },
  { fg: 'textPrimary', bg: 'bgSurface', min: 4.5 },
  { fg: 'textPrimary', bg: 'bgRaised', min: 4.5 },
  { fg: 'textPrimary', bg: 'bgSunken', min: 4.5 },
  { fg: 'textSecondary', bg: 'bgCanvas', min: 4.5 },
  { fg: 'textSecondary', bg: 'bgSurface', min: 4.5 },
  { fg: 'textSecondary', bg: 'bgSunken', min: 4.5 },
  { fg: 'textTertiary', bg: 'bgCanvas', min: 4.5 },
  { fg: 'textTertiary', bg: 'bgSurface', min: 4.5 },
  { fg: 'accentInk', bg: 'bgCanvas', min: 4.5 },
  { fg: 'accentInk', bg: 'bgSurface', min: 4.5 },
  { fg: 'textPrimary', bg: 'accentSoft', min: 4.5 },
  { fg: 'accentDeep', bg: 'accentSoft', min: 4.5 },
  { fg: 'textOnAccent', bg: 'accentFill', min: 4.5 },
  { fg: 'textOnAccentDeep', bg: 'accentDeep', min: 4.5 },
  { fg: 'successInk', bg: 'bgCanvas', min: 4.5 },
  { fg: 'successInk', bg: 'successBg', min: 4.5 },
  { fg: 'warningInk', bg: 'bgCanvas', min: 4.5 },
  { fg: 'warningInk', bg: 'warningBg', min: 4.5 },
  { fg: 'dangerInk', bg: 'bgCanvas', min: 4.5 },
  { fg: 'dangerInk', bg: 'dangerBg', min: 4.5 },
  // Non-text UI boundaries: WCAG 1.4.11 requires 3:1.
  { fg: 'borderControl', bg: 'bgCanvas', min: 3 },
  { fg: 'borderControl', bg: 'bgSurface', min: 3 },
  { fg: 'borderFocus', bg: 'bgCanvas', min: 3 },
  { fg: 'borderFocus', bg: 'bgSurface', min: 3 },
];

/** 4-point spacing rhythm. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
  '6xl': 64,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const fontFamily = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semibold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  extrabold: 'Manrope_800ExtraBold',
  /**
   * Numeric and technical readouts — file sizes, dimensions, compression
   * percentages, format signatures. Already on device on both platforms, so it
   * adds nothing to the bundle, and its tabular figures stop the before/after
   * numbers on the result screen from jittering as they animate.
   */
  mono: 'monospace',
} as const;

export type TypeStyle = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
};

/**
 * Sizes are unscaled base values. Components pass them through `scaleFont` from
 * the theme so Dynamic Type and Android font scaling are honoured everywhere.
 */
export const typography = {
  display: { fontFamily: fontFamily.extrabold, fontSize: 34, lineHeight: 40, letterSpacing: -0.8 },
  h1: { fontFamily: fontFamily.bold, fontSize: 28, lineHeight: 34, letterSpacing: -0.5 },
  h2: { fontFamily: fontFamily.bold, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  h3: { fontFamily: fontFamily.semibold, fontSize: 18, lineHeight: 24, letterSpacing: -0.2 },
  body: { fontFamily: fontFamily.medium, fontSize: 16, lineHeight: 24, letterSpacing: 0 },
  bodySm: { fontFamily: fontFamily.medium, fontSize: 14, lineHeight: 20, letterSpacing: 0 },
  label: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 16, letterSpacing: 0.3 },
  caption: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16, letterSpacing: 0.1 },
  mono: { fontFamily: fontFamily.mono, fontSize: 14, lineHeight: 20, letterSpacing: 0 },
  monoLg: { fontFamily: fontFamily.mono, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
} as const satisfies Record<string, TypeStyle>;

export type TypeScaleName = keyof typeof typography;

/**
 * Elevation as opacity + geometry only; the colour comes from `shadowColor` so the
 * shadow stays warm in light mode and neutral in dark mode.
 */
export const elevation = {
  none: { opacity: 0, radius: 0, offsetY: 0, androidElevation: 0 },
  sm: { opacity: 0.07, radius: 8, offsetY: 2, androidElevation: 2 },
  md: { opacity: 0.1, radius: 16, offsetY: 4, androidElevation: 5 },
  lg: { opacity: 0.14, radius: 28, offsetY: 10, androidElevation: 12 },
} as const;

export type ElevationName = keyof typeof elevation;

/** Minimum touch target, both platforms' guidance rounded up to a common value. */
export const hitTarget = 48;

export const duration = {
  instant: 100,
  fast: 160,
  normal: 240,
  slow: 380,
} as const;

/** Everything the generator serialises into Swift and Kotlin. */
export const tokens = {
  palette,
  colors,
  space,
  radius,
  fontFamily,
  typography,
  elevation,
  hitTarget,
  duration,
} as const;
