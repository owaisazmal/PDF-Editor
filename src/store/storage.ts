// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { createMMKV } from 'react-native-mmkv';

/**
 * Everything this app remembers between launches.
 *
 * Which is deliberately very little. An app whose central claim is that it collects
 * nothing has to be able to say exactly what it does keep, so this is the only place that
 * writes to disk outside the converted files themselves, and the list is short:
 *
 *   - what you converted and when, as counts, sizes and file names
 *   - option presets you chose to save
 *   - the settings you last used
 *
 * It never stores file contents, never stores the source paths of files outside the app's
 * own storage, and never stores a PDF password. Nothing here leaves the device — there is
 * no code in the app that could send it, and release builds on Android ship without the
 * INTERNET permission at all.
 *
 * MMKV rather than AsyncStorage because reads are synchronous: the history screen and the
 * preset row can render on first frame instead of flashing empty and filling in.
 */
export const storage = createMMKV({ id: 'converter' });

/**
 * Bumped when a stored shape changes incompatibly.
 *
 * On a mismatch the affected key is dropped rather than migrated. That is the right trade
 * for this data: losing a history list is a shrug, and a half-migrated record that makes
 * a screen throw is not.
 */
export const SCHEMA_VERSION = 1;

const versionKey = (key: string) => `${key}.version`;

/** Reads and validates, or returns the fallback and clears what it could not read. */
export function read<T>(key: string, validate: (raw: unknown) => T | null, fallback: T): T {
  if (storage.getNumber(versionKey(key)) !== SCHEMA_VERSION) {
    if (storage.contains(key)) storage.remove(key);
    return fallback;
  }

  const stored = storage.getString(key);
  if (stored === undefined) return fallback;

  try {
    const parsed = validate(JSON.parse(stored) as unknown);
    if (parsed !== null) return parsed;
  } catch {
    // Unreadable rather than absent. Same treatment either way.
  }

  storage.remove(key);
  return fallback;
}

export function write(key: string, value: unknown): void {
  storage.set(key, JSON.stringify(value));
  storage.set(versionKey(key), SCHEMA_VERSION);
}

export function remove(key: string): void {
  storage.remove(key);
  storage.remove(versionKey(key));
}

/**
 * Forgets everything, for the Settings screen.
 *
 * A single call rather than a list of keys to remember to update, because the promise
 * being kept here is "clear everything", and a version of it that misses a key is worse
 * than not offering it.
 */
export function clearAll(): void {
  storage.clearAll();
}

export const KEYS = {
  history: 'history',
  presets: 'presets',
  lastOptions: 'lastOptions',
  appearance: 'appearance',
} as const;
