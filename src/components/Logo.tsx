// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import {
  Image,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/theme';

/**
 * The mark, as four template layers the app tints at run time.
 *
 * Each file is white on transparent and carries one part of the folded kite. Tinting them
 * with tokens makes the logo theme-correct by construction — ink for the face and the
 * tail, the accent fill for the two flaps — without a flattened copy per scheme, and
 * without an SVG dependency the app has no other use for. The split into parts is what
 * lets the launch animation fold each flap on its own hinge. All four are drawn by
 * `scripts/gen-app-icons.mjs` from the same geometry as the app icon.
 */
export const MARK_LAYERS: Record<'face' | 'flapLeft' | 'flapRight' | 'tail', ImageSourcePropType> =
  {
    face: require('../../assets/brand/mark-face.png'),
    flapLeft: require('../../assets/brand/mark-flap-left.png'),
    flapRight: require('../../assets/brand/mark-flap-right.png'),
    tail: require('../../assets/brand/mark-tail.png'),
  };

export type LogoProps = {
  /** Width and height of the mark's square box, in points. */
  size?: number;
  /** Draws the whole mark in the text colour, for a place where amber would shout. */
  monochrome?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string | undefined;
};

/** The Kitefold mark, coloured from the current scheme. */
export function Logo({ size = 40, monochrome = false, style, testID }: LogoProps) {
  const theme = useTheme();
  const ink = theme.color.textPrimary;
  const fill = monochrome ? ink : theme.color.accentFill;
  const box = { width: size, height: size };

  return (
    <View
      style={[box, style]}
      testID={testID}
      accessibilityRole="image"
      // The product's name rather than a catalogue string: a brand reads the same in every
      // language, which is also why the share sheet's label is never translated.
      accessibilityLabel="Kitefold"
    >
      <Image
        source={MARK_LAYERS.flapLeft}
        style={[StyleSheet.absoluteFill, box, { tintColor: fill }]}
      />
      <Image
        source={MARK_LAYERS.flapRight}
        style={[StyleSheet.absoluteFill, box, { tintColor: fill }]}
      />
      <Image source={MARK_LAYERS.face} style={[StyleSheet.absoluteFill, box, { tintColor: ink }]} />
      <Image source={MARK_LAYERS.tail} style={[StyleSheet.absoluteFill, box, { tintColor: ink }]} />
    </View>
  );
}
