// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { createContext, useContext, useMemo, type ReactNode } from 'react';
// eslint-disable-next-line no-restricted-imports -- the one place the OS scheme is read.
import { useColorScheme, useWindowDimensions, type TextStyle, type ViewStyle } from 'react-native';

import {
  colors,
  duration,
  elevation,
  hitTarget,
  radius,
  space,
  typography,
  type ColorSchemeName,
  type ColorTokens,
  type ElevationName,
  type TypeScaleName,
} from './tokens';

export type Theme = {
  scheme: ColorSchemeName;
  isDark: boolean;
  color: ColorTokens;
  space: typeof space;
  radius: typeof radius;
  duration: typeof duration;
  hitTarget: number;

  /**
   * A resolved text style at the current font scale.
   *
   * React Native scales `fontSize` for Dynamic Type on its own but leaves `lineHeight`
   * alone, which turns a scaled-up paragraph into overlapping lines. Scaling both here
   * keeps the vertical rhythm intact at every accessibility size, and the components
   * then set `allowFontScaling={false}` so scaling is not applied twice.
   */
  text: (name: TypeScaleName) => TextStyle;

  /** Platform-correct shadow for an elevation step, coloured from the scheme. */
  shadow: (name: ElevationName) => ViewStyle;
};

const ThemeContext = createContext<Theme | null>(null);

/**
 * Font scaling is capped at 1.6. Above that, a 34pt display heading becomes taller than
 * a phone's safe area and the layout stops being usable rather than more accessible.
 * Body text keeps scaling to the cap, which covers every iOS accessibility size short
 * of the largest two.
 */
const MAX_FONT_SCALE = 1.6;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const osScheme = useColorScheme();
  const { fontScale } = useWindowDimensions();

  const value = useMemo<Theme>(() => {
    const scheme: ColorSchemeName = osScheme === 'dark' ? 'dark' : 'light';
    const color = colors[scheme];
    const scale = Math.min(Math.max(fontScale, 1), MAX_FONT_SCALE);

    return {
      scheme,
      isDark: scheme === 'dark',
      color,
      space,
      radius,
      duration,
      hitTarget,

      text: (name) => {
        const style = typography[name];
        return {
          fontFamily: style.fontFamily,
          fontSize: Math.round(style.fontSize * scale),
          lineHeight: Math.round(style.lineHeight * scale),
          letterSpacing: style.letterSpacing,
        };
      },

      shadow: (name) => {
        const step = elevation[name];
        if (step.androidElevation === 0) return {};
        return {
          shadowColor: color.shadowColor,
          shadowOpacity: step.opacity,
          shadowRadius: step.radius,
          shadowOffset: { width: 0, height: step.offsetY },
          elevation: step.androidElevation,
        };
      },
    };
  }, [osScheme, fontScale]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error('useTheme must be used inside <ThemeProvider>.');
  }
  return theme;
}
