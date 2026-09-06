// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useCallback, useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Appearance,
  Easing,
  Image,
  StyleSheet,
  type TransformsStyle,
} from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

import { MARK_LAYERS } from '@/components/Logo';
import { MARK_GEOMETRY } from '@/generated/markGeometry';
import { colors } from '@/theme';
import { SPLASH_MARK_SIZE } from './splash';

/**
 * The timeline, in milliseconds. A launch animation is a greeting, not a feature: the
 * whole thing is over in about a second, and the home screen is underneath from the
 * first frame.
 */
const HOLD = 120; // the finished mark, still, while the splash hands over unseen
const OPEN = 300; // a flap unfolding flat
const REST = 40; // the sheet lying open
const CLOSE = 320; // the flap folding back
const STAGGER = 70; // the second flap follows the first
const LIFT_AT = HOLD + OPEN + REST + CLOSE + STAGGER;
const LIFT = 360;
const FADE = 340;

/** Image layers the overlay draws: both sides of each flap, the face, and the tail. */
const LAYER_COUNT = 6;

type Hinge = { pivot: readonly [number, number]; degrees: number };
/** One entry of a React Native transform list. */
type Transform = Exclude<NonNullable<TransformsStyle['transform']>, string>[number];
type Transforms = Animated.WithAnimatedArray<Transform>;

/**
 * Wraps transforms so they act about a point of the mark's box rather than its centre.
 *
 * React Native applies a transform list to a point from the last entry to the first, and
 * always about the view's centre. Moving the pivot onto the centre first and back again
 * afterwards is the whole trick, and it is done with plain translations because those
 * are the one transform every platform, renderer and animation driver agrees on.
 */
function about(pivot: readonly [number, number], transforms: Transforms): Transforms {
  const dx = (pivot[0] - 0.5) * SPLASH_MARK_SIZE;
  const dy = (pivot[1] - 0.5) * SPLASH_MARK_SIZE;
  return [
    { translateX: dx },
    { translateY: dy },
    ...transforms,
    { translateX: -dx },
    { translateY: -dy },
  ];
}

/**
 * Turns a flap about the kite's outer edge it was creased along.
 *
 * The rotation is composed from the hinge outward: bring the hinge onto the vertical
 * axis, fold about it, put the hinge back.
 */
const hingeTransform = (fold: Animated.Value, hinge: Hinge): Transforms => [
  { perspective: 900 },
  ...about(hinge.pivot, [
    { rotate: `${hinge.degrees}deg` },
    { rotateY: fold.interpolate({ inputRange: [0, 180], outputRange: ['0deg', '180deg'] }) },
    { rotate: `${-hinge.degrees}deg` },
  ]),
];

/**
 * Past a right angle a flap shows its other side, which is the front of the sheet.
 *
 * Two copies of the flap, one in each colour, swap by opacity at that point. Retinting
 * one image would be simpler to write, but a colour that changes mid-animation is not
 * something every platform applies from the animation thread; opacity is.
 */
const sideOpacity = (fold: Animated.Value, side: 'back' | 'face') =>
  fold.interpolate({
    inputRange: [0, 90, 90.001, 180],
    outputRange: side === 'back' ? [1, 1, 0, 0] : [0, 0, 1, 1],
  });

const timing = (
  value: Animated.Value,
  toValue: number,
  duration: number,
  easing: (t: number) => number,
) => Animated.timing(value, { toValue, duration, easing, useNativeDriver: true });

export type LaunchOverlayProps = {
  /** Called once the overlay has faded out; the caller unmounts it. */
  onDone: () => void;
};

/**
 * The app's opening: the kite unfolds into the sheet it was made from, folds back, and
 * lifts away as the home screen comes up beneath it.
 *
 * It starts where the native splash screen stops, so there is no visible handover: the
 * overlay paints the same mark on the same ground at the same size, hides the splash once
 * it is actually on screen, and only then moves. Under "reduce motion" nothing folds or
 * flies; the overlay simply fades, which is the one transition that setting still allows.
 *
 * Driven by React Native's own `Animated` on the native driver rather than by Reanimated.
 * The fold was written for Reanimated first, and on Android its transforms never reached
 * the views while its opacities did: the values animated, the kite sat still. Transforms
 * and opacity are exactly what the native driver has handled on both platforms for years,
 * and this is the only animation in the app, so the mature path is the right one.
 */
export function LaunchOverlay({ onDone }: LaunchOverlayProps) {
  /**
   * The device's scheme, not the app's.
   *
   * The native splash screen can only follow the device, and this overlay's first frame
   * has to be that splash screen's last. Someone who keeps the app dark on a light phone
   * therefore sees a cream splash, a cream fold, and then a dissolve into their dark home
   * screen, which is one soft transition instead of a hard cut before the fold. Read once,
   * at mount, because the splash it has to match was drawn before this code ran. The
   * theme provider is otherwise the only place the device scheme is consulted.
   */
  const [palette] = useState(
    () => colors[Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'],
  );
  const ink = palette.textPrimary;
  const fill = palette.accentFill;

  // State initialisers rather than refs: created once, and never read as a ref during
  // render, which is what the hooks lint forbids.
  const [foldLeft] = useState(() => new Animated.Value(0));
  const [foldRight] = useState(() => new Animated.Value(0));
  const [sway] = useState(() => new Animated.Value(0));
  const [lift] = useState(() => new Animated.Value(0));
  const [opacity] = useState(() => new Animated.Value(1));

  /**
   * On screen means laid out with every layer decoded, not merely mounted.
   *
   * Layout precedes the first paint, and a bundled image is decoded off the main thread
   * and appears a few frames after the view that shows it, on Android in particular.
   * Hiding the splash on layout alone showed a bare window for half a second and then a
   * kite assembling itself part by part, already folding. Failures count as loaded so a
   * missing file cannot leave the splash up; the fallback in App.tsx covers the rest.
   */
  const [laidOut, setLaidOut] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const onLayout = useCallback(() => setLaidOut(true), []);
  const onLoad = useCallback(() => setLoaded((count) => count + 1), []);
  const painted = laidOut && loaded >= LAYER_COUNT;

  useEffect(() => {
    if (!painted) return;
    let cancelled = false;

    // A beat after the last layer arrived, so its frame has been presented before the
    // splash beneath it goes.
    const hide = setTimeout(() => {
      void SplashScreen.hideAsync().catch(() => {});
    }, 50);

    // Asked directly rather than through the hook, which reports `false` until the answer
    // arrives; a timeline that starts before it does would fold for someone who asked it
    // not to. The answer takes a frame or two, which the hold absorbs.
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;

      const finish = ({ finished }: { finished: boolean }) => {
        if (finished) onDone();
      };

      if (reduce) {
        Animated.sequence([Animated.delay(HOLD), timing(opacity, 0, 220, Easing.linear)]).start(
          finish,
        );
        return;
      }

      const beat = (fold: Animated.Value, delay: number) =>
        Animated.sequence([
          Animated.delay(delay),
          timing(fold, 180, OPEN, Easing.inOut(Easing.cubic)),
          Animated.delay(REST),
          timing(fold, 0, CLOSE, Easing.out(Easing.cubic)),
        ]);

      Animated.parallel([
        beat(foldLeft, HOLD),
        beat(foldRight, HOLD + STAGGER),
        Animated.sequence([
          Animated.delay(HOLD),
          timing(sway, -8, 280, Easing.out(Easing.quad)),
          timing(sway, 6, 320, Easing.inOut(Easing.quad)),
          timing(sway, 0, 260, Easing.out(Easing.quad)),
        ]),
        Animated.sequence([
          Animated.delay(LIFT_AT),
          timing(lift, 1, LIFT, Easing.in(Easing.cubic)),
        ]),
        Animated.sequence([
          Animated.delay(LIFT_AT + 40),
          timing(opacity, 0, FADE, Easing.out(Easing.quad)),
        ]),
      ]).start(finish);
    });

    return () => {
      cancelled = true;
      clearTimeout(hide);
    };
  }, [painted, onDone, foldLeft, foldRight, sway, lift, opacity]);

  const swayDegrees = sway.interpolate({ inputRange: [-10, 10], outputRange: ['-10deg', '10deg'] });
  const liftY = lift.interpolate({ inputRange: [0, 1], outputRange: [0, -44] });
  const liftScale = lift.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] });

  return (
    <Animated.View
      testID="launch-overlay"
      onLayout={onLayout}
      style={[
        StyleSheet.absoluteFill,
        styles.overlay,
        { backgroundColor: palette.bgCanvas, opacity },
      ]}
    >
      <Animated.View
        style={[styles.mark, { transform: [{ translateY: liftY }, { scale: liftScale }] }]}
      >
        <Animated.View
          style={[styles.layer, { transform: hingeTransform(foldLeft, MARK_GEOMETRY.flapLeft) }]}
        >
          <Animated.Image
            source={MARK_LAYERS.flapLeft}
            onLoad={onLoad}
            onError={onLoad}
            style={[styles.layer, { tintColor: fill, opacity: sideOpacity(foldLeft, 'back') }]}
          />
          <Animated.Image
            source={MARK_LAYERS.flapLeft}
            onLoad={onLoad}
            onError={onLoad}
            style={[styles.layer, { tintColor: ink, opacity: sideOpacity(foldLeft, 'face') }]}
          />
        </Animated.View>
        <Animated.View
          style={[styles.layer, { transform: hingeTransform(foldRight, MARK_GEOMETRY.flapRight) }]}
        >
          <Animated.Image
            source={MARK_LAYERS.flapRight}
            onLoad={onLoad}
            onError={onLoad}
            style={[styles.layer, { tintColor: fill, opacity: sideOpacity(foldRight, 'back') }]}
          />
          <Animated.Image
            source={MARK_LAYERS.flapRight}
            onLoad={onLoad}
            onError={onLoad}
            style={[styles.layer, { tintColor: ink, opacity: sideOpacity(foldRight, 'face') }]}
          />
        </Animated.View>
        <Image
          source={MARK_LAYERS.face}
          onLoad={onLoad}
          onError={onLoad}
          style={[styles.layer, { tintColor: ink }]}
        />
        <Animated.Image
          source={MARK_LAYERS.tail}
          onLoad={onLoad}
          onError={onLoad}
          style={[
            styles.layer,
            {
              tintColor: ink,
              transform: about(MARK_GEOMETRY.bottom, [{ rotate: swayDegrees }]),
            },
          ]}
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { alignItems: 'center', justifyContent: 'center' },
  mark: { width: SPLASH_MARK_SIZE, height: SPLASH_MARK_SIZE },
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SPLASH_MARK_SIZE,
    height: SPLASH_MARK_SIZE,
  },
});
