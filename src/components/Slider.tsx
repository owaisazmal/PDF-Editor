// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useCallback, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';

import { Text } from './Text';
import { useTheme } from '@/theme';

export type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Snap increment. Also the step a screen reader's increment action moves by. */
  step?: number;
  /** Rendered next to the label — the live readout, not the raw number. */
  valueLabel: string;
  onChange: (value: number) => void;
  /** Called once when the gesture ends, for work too expensive to run per frame. */
  onCommit?: (value: number) => void;
  disabled?: boolean;
  style?: ViewStyle;
  testID?: string;
};

/**
 * A slider built rather than imported.
 *
 * React Native ships none, and the obvious library is difficult to theme to a token
 * system — which matters here, because this control sits next to a live size readout
 * and needs to read as part of the same object. Owning it also means owning the
 * accessibility: `adjustable` with real increment and decrement actions, so VoiceOver
 * and TalkBack can set a quality value without dragging anything.
 *
 * `onChange` fires continuously and `onCommit` only when the finger lifts, because
 * re-encoding an image to estimate its size is far too expensive to do per frame.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  valueLabel,
  onChange,
  onCommit,
  disabled = false,
  style,
  testID,
}: SliderProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  /**
   * The track's left edge in page coordinates.
   *
   * Needed because `locationX` is relative to whichever subview the touch actually
   * lands on, and the thumb slides under the finger mid-drag — so the same finger
   * position reports wildly different `locationX` values as it crosses the thumb.
   * Page coordinates are the only stable frame. Held as state rather than a ref so
   * nothing is read from a ref during render.
   */
  const [trackPageX, setTrackPageX] = useState(0);


  const clampToStep = useCallback(
    (raw: number) => {
      const stepped = Math.round(raw / step) * step;
      return Math.min(max, Math.max(min, stepped));
    },
    [min, max, step],
  );

  const valueFromX = useCallback(
    (x: number, fallback: number) => {
      const usable = width - THUMB;
      if (usable <= 0) return fallback;
      const ratio = Math.min(1, Math.max(0, (x - THUMB / 2) / usable));
      return clampToStep(min + ratio * (max - min));
    },
    [clampToStep, min, max, width],
  );

  /**
   * Rebuilt every render rather than memoised.
   *
   * `PanResponder.create` is cheap, and the responder system reads the handlers from
   * the view's current props at gesture time — so closing over this render's `value`
   * and callbacks is both correct and simpler than keeping a mirror of them in refs
   * that then has to be written during render.
   *
   * Nothing changes on touch-down, and that is deliberate. This control lives inside a
   * scrolling screen, and setting the value in `onPanResponderGrant` meant that merely
   * resting a finger on the track while starting to scroll moved the slider — a swipe
   * past the margin control silently changed the margin. The value now moves only once
   * the gesture is clearly horizontal, or on release if the finger never travelled,
   * which keeps tap-to-set working without hijacking a scroll.
   */
  const panHandlers = PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled,
    // A vertical drag belongs to the ScrollView, not to this.
    onMoveShouldSetPanResponder: (_event, pan) =>
      !disabled && Math.abs(pan.dx) > Math.abs(pan.dy),
    // Granted so a tap can be recognised on release; the ScrollView is still free to
    // take the gesture back, and by then nothing has been changed.
    onPanResponderTerminationRequest: () => true,
    // Deliberately empty. Whether this is a drag or a tap is not knowable yet, and
    // guessing is what moved the value during a scroll.
    onPanResponderGrant: () => {},
    onPanResponderMove: (_event, pan) => {
      // `dx` accumulates from where the finger landed, so this needs no flag to
      // remember what kind of gesture it is — which matters, because a flag would have
      // to be a ref read from a function built during render.
      if (Math.abs(pan.dx) <= TAP_SLOP) return;
      onChange(valueFromX(pan.moveX - trackPageX, value));
    },
    onPanResponderRelease: (event, pan) => {
      if (Math.abs(pan.dx) <= TAP_SLOP) {
        // The finger never travelled: a tap on the track, so jump to where it landed.
        const tapped = valueFromX(event.nativeEvent.pageX - trackPageX, value);
        onChange(tapped);
        onCommit?.(tapped);
        return;
      }
      onCommit?.(value);
    },
    // The ScrollView took the gesture back. If nothing moved there is nothing to
    // commit, and if something did, the value is already where the finger left it.
    onPanResponderTerminate: (_event, pan) => {
      if (Math.abs(pan.dx) > TAP_SLOP) onCommit?.(value);
    },
  }).panHandlers;

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
    // measure() is the only way to get the page-relative origin, and it is asynchronous.
    event.currentTarget.measure?.((_x, _y, _w, _h, pageX) => setTrackPageX(pageX));
  }, []);

  const fraction = max > min ? (value - min) / (max - min) : 0;
  const thumbLeft = Math.max(0, Math.min(width - THUMB, fraction * (width - THUMB)));

  return (
    <View style={style} testID={testID}>
      <View style={styles.header}>
        <Text variant="label" color="textSecondary">
          {label}
        </Text>
        <Text variant="mono" color={disabled ? 'textDisabled' : 'accentInk'}>
          {valueLabel}
        </Text>
      </View>

      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: value, text: valueLabel }}
        accessibilityState={{ disabled }}
        // Lets a screen reader change the value without a drag gesture.
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          if (disabled) return;
          const delta = event.nativeEvent.actionName === 'increment' ? step : -step;
          const next = clampToStep(value + delta);
          onChange(next);
          onCommit?.(next);
        }}
        onLayout={onLayout}
        style={[styles.hitArea, { opacity: disabled ? 0.45 : 1 }]}
        {...panHandlers}
      >
        <View
          style={[
            styles.track,
            { backgroundColor: theme.color.bgSunken, borderRadius: theme.radius.pill },
          ]}
        >
          <View
            style={[
              styles.fill,
              {
                width: `${fraction * 100}%`,
                backgroundColor: theme.color.accentFill,
                borderRadius: theme.radius.pill,
              },
            ]}
          />
        </View>

        <View
          style={[
            styles.thumb,
            {
              left: thumbLeft,
              backgroundColor: theme.color.bgRaised,
              borderColor: theme.color.accentDeep,
              borderRadius: theme.radius.pill,
            },
            theme.shadow('sm'),
          ]}
        />
      </View>
    </View>
  );
}

const THUMB = 28;

/**
 * How far sideways a finger travels before the gesture counts as a drag rather than a
 * tap. Small enough that a deliberate drag feels immediate, large enough that the wobble
 * in a tap does not move the value.
 */
const TAP_SLOP = 3;

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  // Taller than the track so the touch target clears the 44pt minimum.
  hitArea: { height: 44, justifyContent: 'center', marginTop: 8 },
  track: { height: 8, overflow: 'hidden' },
  fill: { height: '100%' },
  thumb: { position: 'absolute', width: THUMB, height: THUMB, borderWidth: 3 },
});
