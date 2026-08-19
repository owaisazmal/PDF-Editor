// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { create } from 'zustand';

import {
  buildOptions,
  conversionOptionsSchema,
  type ConversionOptionsInput,
} from '@/engine/options';
import type { FormatId } from '@/engine/formats';
import { imageDefaults } from '@/theme/tokens';
import { KEYS, read, write } from './storage';

/**
 * The settings the user is currently editing.
 *
 * Held as the loose input shape rather than the validated output, because a half-typed
 * value has to be representable while it is being edited — validation happens when the
 * job is submitted, not on every keystroke.
 *
 * The last-used settings are remembered across launches, because someone who converts
 * at quality 70 does it every time and re-setting the slider on each launch is a tax on
 * the people who use the app most. Only the settings survive — never a file, never a
 * path.
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

/**
 * Validated on the way in as well as on the way out.
 *
 * Stored settings are the one input to this store that did not come from the UI, so they
 * are the one that can be wrong: written by an older build, or edited by hand. A rejected
 * set falls back to the defaults rather than putting the app into a state its own schema
 * would refuse.
 */
const storedOptions = (): ConversionOptionsInput | null =>
  read<ConversionOptionsInput | null>(
    KEYS.lastOptions,
    (raw) => (conversionOptionsSchema.safeParse(raw).success ? (raw as ConversionOptionsInput) : null),
    null,
  );

/** Remembering the target format would override the task the user just tapped. */
const withFormat = (
  options: ConversionOptionsInput,
  format: FormatId,
): ConversionOptionsInput => ({ ...options, targetFormat: format });

export const useOptionsStore = create<OptionsState>((set, get) => {
  const persist = (options: ConversionOptionsInput) => {
    write(KEYS.lastOptions, options);
    return { options };
  };

  return {
    options: storedOptions() ?? defaultOptionsFor('jpeg'),

    setTargetFormat: (format) => set((state) => persist(withFormat(state.options, format))),
    patch: (patch) => set((state) => persist({ ...state.options, ...patch })),
    replace: (options) => set(persist(options)),
    /**
     * Reopens a task with what was used last, not with the factory defaults — that is the
     * whole point of remembering. The format still comes from the task being started.
     */
    resetFor: (format) => set(persist(withFormat(storedOptions() ?? defaultOptionsFor(format), format))),
    validated: () => buildOptions(get().options),
  };
});
