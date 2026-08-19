// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';

import { Text, type TextColor } from './Text';

export type SectionLabelProps = {
  /** Natural case, as it is written in the catalogue. This uppercases it for display. */
  children: string;
  color?: TextColor;
  style?: StyleProp<TextStyle>;
};

/**
 * The small all-caps heading above a group of controls.
 *
 * The uppercasing is presentation, applied here, rather than something the catalogue
 * carries. Storing "SELECTED FILE" would have meant a second key for every heading —
 * because the same words are also the group's accessible name, and a screen reader
 * announcing "S-E-L-E-C-T-E-D" or shouting it is not what anyone wants — and it would
 * have asked eight translators to reproduce a convention that half their scripts do not
 * have. Chinese, Japanese and Arabic have no letter case at all, so for them this is
 * correctly a no-op.
 *
 * The accessible name is set explicitly to the untransformed string, because React
 * Native applies `textTransform` to the text it hands the platform on iOS rather than
 * only to the glyphs it draws.
 */
export function SectionLabel({ children, color = 'textSecondary', style }: SectionLabelProps) {
  return (
    <Text variant="label" color={color} heading accessibilityLabel={children} style={[styles.caps, style]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  caps: { textTransform: 'uppercase' },
});
