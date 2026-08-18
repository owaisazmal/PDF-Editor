// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { useReducedMotion } from '@/utils/useReducedMotion';

import { useTheme } from '@/theme';

export type ProgressBarProps = {
  /** 0–1. Values outside the range are clamped rather than overflowing the track. */
  fraction: number;
  /** Spoken by screen readers in place of the raw percentage. */
  accessibilityLabel: string;
};

/**
 * Determinate progress.
 *
 * The fill is animated rather than set directly because native coalesces progress to
 * roughly 10 Hz — stepping straight to each value makes a fast batch look like it is
 * stuttering, when what is actually happening is that it is finishing files faster than
 * the event budget reports them. Interpolating between the samples shows the truth more
 * honestly than the samples do.
 */
export function ProgressBar({ fraction, accessibilityLabel }: ProgressBarProps) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const clamped = Math.min(1, Math.max(0, fraction));
  // Lazy state rather than a ref: the value must be created once and never read
  // during render, which is exactly what `useState`'s initialiser gives.
  const [animated] = useState(() => new Animated.Value(clamped));

  useEffect(() => {
    if (reducedMotion) {
      animated.setValue(clamped);
      return;
    }
    Animated.timing(animated, {
      toValue: clamped,
      duration: theme.duration.fast,
      // Width cannot be driven on the native thread; the alternative is a scale
      // transform, which blurs the rounded cap at low fractions.
      useNativeDriver: false,
    }).start();
  }, [clamped, animated, reducedMotion, theme.duration.fast]);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[
        styles.track,
        {
          backgroundColor: theme.color.bgSunken,
          borderRadius: theme.radius.pill,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: theme.color.borderHairline,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.fill,
          {
            backgroundColor: theme.color.accentFill,
            borderRadius: theme.radius.pill,
            width: animated.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
            }),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 10, overflow: 'hidden' },
  fill: { height: '100%' },
});
