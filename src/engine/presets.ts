// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import type { ConversionOptionsInput } from './options';

/**
 * Named sizes, because almost nobody knows the pixel dimensions they need.
 *
 * People arrive with a destination in mind — "this has to fit in an email", "this is
 * going on a story" — not a number. Each preset is that destination expressed as
 * settings, and the catalogue says what it actually does so the choice is checkable.
 *
 * The words live in `options.resizePresets.<id>`, keyed by the same `id` the option
 * matcher uses. Note the namespace: `options.presets` is already the section heading, and
 * i18next cannot hold both a string and a group at one path.
 */
export type ResizePreset = {
  /** Also the catalogue key: `options.resizePresets.<id>.label` and `.detail`. */
  id: string;
  apply: (options: ConversionOptionsInput) => ConversionOptionsInput;
};

const maxDimension = (width: number, height: number) =>
  ({
    mode: 'maxDimension' as const,
    maxWidth: width,
    maxHeight: height,
    percent: 100,
    exactWidth: 0,
    exactHeight: 0,
    // Enlarging a small image to hit a preset produces a blurry file that is bigger
    // than the original in every sense. Presets only ever shrink.
    allowUpscale: false,
  });

export const RESIZE_PRESETS: readonly ResizePreset[] = [
  {
    id: 'original',
    apply: (options) => ({
      ...options,
      resize: {
        mode: 'none',
        percent: 100,
        maxWidth: 0,
        maxHeight: 0,
        exactWidth: 0,
        exactHeight: 0,
        allowUpscale: false,
      },
      targetByteSize: 0,
    }),
  },
  {
    id: 'email',
    apply: (options) => ({
      ...options,
      resize: maxDimension(2048, 2048),
      // Expressed as a size target rather than a quality guess, because "under 1 MB"
      // is the actual requirement and the encoder can search for it.
      targetByteSize: 1_000_000,
    }),
  },
  {
    id: 'instagram-square',
    apply: (options) => ({ ...options, resize: maxDimension(1080, 1080) }),
  },
  {
    id: 'instagram-story',
    apply: (options) => ({ ...options, resize: maxDimension(1080, 1920) }),
  },
  {
    id: 'hd',
    apply: (options) => ({ ...options, resize: maxDimension(1920, 1080) }),
  },
  {
    id: 'uhd',
    apply: (options) => ({ ...options, resize: maxDimension(3840, 2160) }),
  },
  {
    id: 'passport',
    apply: (options) => ({
      ...options,
      resize: {
        mode: 'exact',
        percent: 100,
        maxWidth: 0,
        maxHeight: 0,
        exactWidth: 600,
        exactHeight: 600,
        // The one preset that may enlarge: a passport photo has a required size, and a
        // too-small one is rejected rather than merely soft.
        allowUpscale: true,
      },
    }),
  },
];

/** Which preset the current options correspond to, if any. */
export function matchPreset(options: ConversionOptionsInput): string | null {
  for (const preset of RESIZE_PRESETS) {
    const applied = preset.apply(options);
    if (
      JSON.stringify(applied.resize) === JSON.stringify(options.resize) &&
      (applied.targetByteSize ?? 0) === (options.targetByteSize ?? 0)
    ) {
      return preset.id;
    }
  }
  return null;
}
