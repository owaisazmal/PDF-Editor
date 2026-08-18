// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { create } from 'zustand';

import type { FormatId } from '@/engine/formats';
import { formatDetector, isNativeAvailable } from '@/native';

/**
 * What this device can actually read and write.
 *
 * Asked of the platform once at startup rather than hardcoded, because the answer is
 * genuinely different per device and per OS version: HEIC decoding needs API 28 on
 * Android, AVIF needs 31, and neither has an encoder there at all. Hardcoding it means
 * offering a conversion that fails at the end of a batch — the worst possible moment to
 * discover the device was never able to do it.
 *
 * Until the report arrives, `isLoaded` is false and callers should treat capability as
 * unknown rather than absent, so the grid does not flash "unsupported" on launch.
 */
export type CapabilitiesState = {
  decode: ReadonlySet<FormatId>;
  encode: ReadonlySet<FormatId>;
  isLoaded: boolean;
  /** Set when the report could not be fetched at all, as opposed to reporting nothing. */
  error: string | null;

  load: () => Promise<void>;
};

export const useCapabilitiesStore = create<CapabilitiesState>((set) => ({
  decode: new Set<FormatId>(),
  encode: new Set<FormatId>(),
  isLoaded: false,
  error: null,

  async load() {
    if (!isNativeAvailable()) {
      // A JS-only environment (tests, or a build without the native modules linked)
      // reports nothing rather than pretending everything works.
      set({ isLoaded: true, error: null });
      return;
    }
    try {
      const report = await formatDetector.supportedFormats();
      set({
        decode: new Set(report.decode),
        encode: new Set(report.encode),
        isLoaded: true,
        error: null,
      });
    } catch (error) {
      set({
        isLoaded: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));

/** A conversion is offerable when the device can read the source and write the target. */
export function canConvert(
  capabilities: Pick<CapabilitiesState, 'decode' | 'encode' | 'isLoaded'>,
  sourceFormats: readonly FormatId[],
  targetFormat: FormatId,
): boolean {
  // Before the report lands, assume yes: flashing "unsupported" on launch and then
  // correcting it is worse than a brief moment of optimism.
  if (!capabilities.isLoaded) return true;
  if (capabilities.encode.size === 0 && capabilities.decode.size === 0) return true;

  if (!capabilities.encode.has(targetFormat)) return false;
  return sourceFormats.some((format) => capabilities.decode.has(format));
}
