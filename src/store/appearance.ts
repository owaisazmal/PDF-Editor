// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import type { ColorSchemeName } from 'react-native';
import { create } from 'zustand';

import { KEYS, read, write } from './storage';

/**
 * Which colour scheme the app draws in.
 *
 * Three choices rather than a switch, because a two-state toggle has to decide what to do
 * on first launch and either answer is wrong for somebody: default to the device and a user
 * who wants light gets dark at night, default to light and a user who runs their phone dark
 * gets a white page in a dark room. Naming the third option lets the app default to light —
 * which is the design the tokens were drawn for — without taking the system away from
 * anyone who wants it.
 */
export type AppearanceMode = 'light' | 'dark' | 'system';

export const APPEARANCE_MODES: readonly AppearanceMode[] = ['light', 'dark', 'system'];

export type AppearanceState = {
  mode: AppearanceMode;
  setMode: (mode: AppearanceMode) => void;
};

const isMode = (value: unknown): value is AppearanceMode =>
  typeof value === 'string' && (APPEARANCE_MODES as readonly string[]).includes(value);

const parse = (raw: unknown): AppearanceMode | null => (isMode(raw) ? raw : null);

/**
 * Light, deliberately.
 *
 * The palette was drawn light-first and the dark scheme is its counterpart rather than its
 * equal, so light is the version the app is at its best in. Anyone who would rather follow
 * the device is one tap away, and that choice is remembered.
 */
export const DEFAULT_MODE: AppearanceMode = 'light';

export const useAppearanceStore = create<AppearanceState>((set) => ({
  mode: read(KEYS.appearance, parse, DEFAULT_MODE),

  setMode(mode) {
    set({ mode });
    write(KEYS.appearance, mode);
  },
}));

/**
 * The scheme to draw in, given the choice and what the device is doing.
 *
 * Pure and exported so it can be tested without mounting a provider — the resolution is
 * the part with a rule in it, and the provider is just the part that subscribes.
 */
export function resolveScheme(
  mode: AppearanceMode,
  // React Native's own type, which includes `'unspecified'` and `null` — both of which
  // mean "the device did not say", and both of which land on light here.
  osScheme: ColorSchemeName,
): 'light' | 'dark' {
  if (mode === 'system') return osScheme === 'dark' ? 'dark' : 'light';
  return mode;
}
