// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { create } from 'zustand';

import { buildOptions, type ConversionOptionsInput } from '@/engine/options';
import type { FormatId } from '@/engine/formats';
import { imageDefaults } from '@/theme/tokens';

/**
 * The settings the user is currently editing.
 *
 * Held as the loose input shape rather than the validated output, because a half-typed
 * value has to be representable while it is being edited — validation happens when the
 * job is submitted, not on every keystroke.
 *
 * Not persisted yet. Remembering the last-used settings, and saving named presets, is
 * Phase 5 work and wants MMKV behind it.
 */
export type OptionsState = {
  options: ConversionOptionsInput;

  setTargetFormat: (format: FormatId) => void;
  patch: (patch: Partial<ConversionOptionsInput>) => void;
  replace: (options: ConversionOptionsInput) => void;
  resetFor: (format: FormatId) => void;
  /** Throws if the current draft is not valid. Used at submit time. */
  validated: () => ReturnType<typeof buildOptions>;
};

export const defaultOptionsFor = (format: FormatId): ConversionOptionsInput => ({
  targetFormat: format,
  quality: 82,
  targetByteSize: 0,
  resize: {
    mode: 'none',
    percent: 100,
    maxWidth: 0,
    maxHeight: 0,
    exactWidth: 0,
    exactHeight: 0,
    allowUpscale: false,
  },
  rotate: 0,
  flipHorizontal: false,
  flipVertical: false,
  metadata: { mode: 'keepExceptGps' },
  convertToSrgb: true,
  background: { color: imageDefaults.backgroundFill },
  lossless: false,
  frameIndex: 0,
});

export const useOptionsStore = create<OptionsState>((set, get) => ({
  options: defaultOptionsFor('jpeg'),

  setTargetFormat: (format) => set((state) => ({ options: { ...state.options, targetFormat: format } })),
  patch: (patch) => set((state) => ({ options: { ...state.options, ...patch } })),
  replace: (options) => set({ options }),
  resetFor: (format) => set({ options: defaultOptionsFor(format) }),
  validated: () => buildOptions(get().options),
}));
