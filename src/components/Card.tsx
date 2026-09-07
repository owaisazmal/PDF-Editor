// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';
import type { ElevationName } from '@/theme/tokens';

export type CardProps = {
  children: ReactNode;
  elevation?: ElevationName;
  selected?: boolean;
  /** Omitted or undefined makes the card a plain container rather than a control. */
  onPress?: (() => void) | undefined;
  // These are pass-through props, so they accept an explicit `undefined` under
  // `exactOptionalPropertyTypes` — a caller computing `cond ? value : undefined`
  // should not have to build the props object conditionally.
  accessibilityLabel?: string | undefined;
  accessibilityHint?: string | undefined;
  style?: ViewStyle | undefined;
  testID?: string | undefined;
};

/**
 * The app's one container. Selected state is carried by background and border
 * together, never by colour alone — a user who cannot distinguish the tint still sees
 * the boundary change.
 */
export function Card({
  children,
  elevation = 'sm',
  selected = false,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: CardProps) {
  const theme = useTheme();

  const surface: ViewStyle = {
    backgroundColor: selected ? theme.color.accentSoft : theme.color.bgSurface,
    borderRadius: theme.radius.lg,
    borderWidth: selected ? 2 : StyleSheet.hairlineWidth * 2,
    borderColor: selected ? theme.color.borderFocus : theme.color.borderHairline,
    padding: theme.space.xl,
  };

  /*
    A card with nothing to tap is still a card with something to say.

    This branch used to drop `testID` and both accessibility props on the floor, which
    read as harmless — a plain container has no role to announce. It was not. A task tile
    the device cannot perform renders exactly here, with `onPress` withheld, and its label
    is the sentence explaining why the tile is closed. Losing it meant the one tile that
    needed explaining was the one tile a screen reader could not describe, while the
    tappable ones next to it read perfectly.

    `accessible` is set only when a label is supplied, because it collapses the subtree
    into a single announcement. That is right for a tile whose label already carries its
    title and reason, and wrong for the section cards elsewhere in the app, which pass no
    label and whose children should each be reachable.
  */
  if (!onPress) {
    return (
      <View
        style={[surface, theme.shadow(elevation), style]}
        testID={testID}
        {...(accessibilityLabel ? { accessible: true, accessibilityLabel } : {})}
        {...(accessibilityHint ? { accessibilityHint } : {})}
      >
        {children}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      accessibilityState={{ selected }}
      style={({ pressed }) => [surface, theme.shadow(elevation), pressed && styles.pressed, style]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
});
