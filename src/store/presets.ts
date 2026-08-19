// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { create } from 'zustand';

import { conversionOptionsSchema, type ConversionOptionsInput } from '@/engine/options';
import { KEYS, read, remove, write } from './storage';

/**
 * Settings the user chose to keep.
 *
 * Distinct from the built-in size presets, which are suggestions the app makes. These are
 * the user's own: a named set of settings they arrived at once and do not want to rebuild.
 * "Email attachments" and "Client proofs" are the shapes people actually save, and both
 * are combinations no built-in list could guess.
 *
 * Stored validated. A preset is written once and applied many times, so the moment to
 * reject a nonsensical one is when it is saved — applying a bad preset later would fail
 * at conversion time, long after the mistake.
 */

/** Enough for the row to stay scannable; more than anyone has been observed to need. */
export const PRESET_LIMIT = 12;

export type Preset = {
  id: string;
  name: string;
  options: ConversionOptionsInput;
};

export type PresetsState = {
  presets: Preset[];
  /** Returns the saved preset, or null when the name or the settings are unusable. */
  save: (name: string, options: ConversionOptionsInput) => Preset | null;
  rename: (id: string, name: string) => void;
  removePreset: (id: string) => void;
  clear: () => void;
};

const isPreset = (value: unknown): value is Preset => {
  const preset = value as Partial<Preset> | null;
  if (typeof preset?.id !== 'string' || typeof preset.name !== 'string') return false;
  // Re-validated on read as well as on write: a file edited by hand, or written by an
  // older build, must not be able to put settings into the app that it would reject.
  return conversionOptionsSchema.safeParse(preset.options).success;
};

const parse = (raw: unknown): Preset[] | null =>
  Array.isArray(raw) ? raw.filter(isPreset) : null;

/** Trimmed and length-capped, because it is drawn in a chip that cannot grow. */
export const cleanPresetName = (name: string): string => name.trim().slice(0, 24);

export const usePresetsStore = create<PresetsState>((set, get) => ({
  presets: read(KEYS.presets, parse, []),

  save(name, options) {
    const cleaned = cleanPresetName(name);
    if (cleaned.length === 0) return null;
    if (!conversionOptionsSchema.safeParse(options).success) return null;

    const preset: Preset = {
      id: `preset-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name: cleaned,
      options,
    };

    // A repeated name replaces rather than duplicates: saving "Email" twice means the
    // second one is a correction, not a second preset the user has to tell apart.
    const existing = get().presets.filter(
      (entry) => entry.name.toLowerCase() !== cleaned.toLowerCase(),
    );
    const presets = [preset, ...existing].slice(0, PRESET_LIMIT);

    set({ presets });
    write(KEYS.presets, presets);
    return preset;
  },

  rename(id, name) {
    const cleaned = cleanPresetName(name);
    if (cleaned.length === 0) return;

    const presets = get().presets.map((preset) =>
      preset.id === id ? { ...preset, name: cleaned } : preset,
    );
    set({ presets });
    write(KEYS.presets, presets);
  },

  removePreset(id) {
    const presets = get().presets.filter((preset) => preset.id !== id);
    set({ presets });
    write(KEYS.presets, presets);
  },

  clear() {
    set({ presets: [] });
    remove(KEYS.presets);
  },
}));
