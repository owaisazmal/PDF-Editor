// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { useTheme } from '@/theme';
import type { ColorTokens, TypeScaleName } from '@/theme/tokens';

/** Colour roles a piece of text is allowed to take. Keeps callers off raw values. */
export type TextColor = Extract<
  keyof ColorTokens,
  | 'textPrimary'
  | 'textSecondary'
  | 'textTertiary'
  | 'textOnAccent'
  | 'textOnAccentDeep'
  | 'textDisabled'
  | 'accentInk'
  | 'accentDeep'
  | 'successInk'
  | 'warningInk'
  | 'dangerInk'
>;

export type TextProps = RNTextProps & {
  variant?: TypeScaleName;
  color?: TextColor;
  /** Aligns digits in columns. Automatic for the mono variants. */
  tabular?: boolean;
  /**
   * Announces this as a heading, and lets a screen reader jump between headings.
   *
   * Automatic for the display and h1–h3 variants, because a heading-sized string is a
   * heading; a section label like "METADATA" is one too and sets this explicitly. Pass
   * `false` for the rare heading-styled string that is not one — a big number, say.
   */
  heading?: boolean;
};

/**
 * Every string in the app renders through here.
 *
 * `allowFontScaling` is off because the theme has already applied the user's font
 * scale to both `fontSize` and `lineHeight` — letting React Native scale again would
 * compound it and break the vertical rhythm. Accessibility scaling is honoured, just
 * in one place instead of two.
 */
/** Variants that are headings unless the caller says otherwise. */
const HEADING_VARIANTS = new Set<TypeScaleName>(['display', 'h1', 'h2', 'h3']);

export function Text({
  variant = 'body',
  color = 'textPrimary',
  tabular,
  heading,
  style,
  ...rest
}: TextProps) {
  const theme = useTheme();
  const isMono = variant === 'mono' || variant === 'monoLg';
  const isHeading = heading ?? HEADING_VARIANTS.has(variant);

  return (
    <RNText
      allowFontScaling={false}
      {...(isHeading ? ({ accessibilityRole: 'header' } as const) : {})}
      style={[
        theme.text(variant),
        { color: theme.color[color] },
        (tabular ?? isMono) && { fontVariant: ['tabular-nums'] },
        style,
      ]}
      {...rest}
    />
  );
}
