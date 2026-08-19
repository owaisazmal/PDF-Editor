// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * This is the only data the app keeps between launches, in an app whose central claim is
 * that it keeps almost nothing. So the rules worth pinning down are the ones that decide
 * what survives, what is refused, and what is thrown away rather than repaired.
 */

import { cleanPresetName, PRESET_LIMIT } from '@/store/presets';
import { clearAll, KEYS, read, storage, write, SCHEMA_VERSION } from '@/store/storage';
import { HISTORY_LIMIT, totalSaved, type HistoryEntry } from '@/store/history';

const entry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: 'a',
  at: 1_700_000_000_000,
  taskId: 'heic-to-jpg',
  taskTitle: 'HEIC to JPG',
  targetFormat: 'jpeg',
  fileCount: 2,
  failedCount: 0,
  bytesBefore: 1000,
  bytesAfter: 400,
  outputNames: ['a.jpg', 'b.jpg'],
  ...overrides,
});

describe('preset names', () => {
  it('trims what people type', () => {
    expect(cleanPresetName('  Email  ')).toBe('Email');
  });

  it('caps a name at what the chip can draw', () => {
    // Silently truncating beats a chip that grows until it breaks the row.
    expect(cleanPresetName('x'.repeat(80))).toHaveLength(24);
  });

  it('reduces a name of only spaces to nothing, which the store refuses', () => {
    expect(cleanPresetName('    ')).toBe('');
  });
});

describe('the stored limits', () => {
  it('keeps history bounded', () => {
    // A converter used daily would otherwise grow a list nobody scrolls and a file
    // nobody notices.
    expect(HISTORY_LIMIT).toBeGreaterThan(50);
    expect(HISTORY_LIMIT).toBeLessThanOrEqual(500);
  });

  it('keeps the preset row scannable', () => {
    expect(PRESET_LIMIT).toBeLessThanOrEqual(20);
  });
});

describe('totalling what was saved', () => {
  it('adds across every entry', () => {
    expect(totalSaved([entry(), entry({ bytesBefore: 500, bytesAfter: 100 })])).toEqual({
      before: 1500,
      after: 500,
    });
  });

  it('is zero for an empty history rather than undefined', () => {
    expect(totalSaved([])).toEqual({ before: 0, after: 0 });
  });

  it('survives a batch that grew rather than shrank', () => {
    // Converting a JPEG to PNG makes it bigger, and the total has to stay honest.
    expect(totalSaved([entry({ bytesBefore: 100, bytesAfter: 900 })])).toEqual({
      before: 100,
      after: 900,
    });
  });
});

describe('what survives a restart', () => {
  const keep = (raw: unknown) => (Array.isArray(raw) ? (raw as number[]) : null);

  beforeEach(() => clearAll());

  it('reads back what it wrote', () => {
    write(KEYS.history, [1, 2, 3]);
    expect(read(KEYS.history, keep, [])).toEqual([1, 2, 3]);
  });

  it('returns the fallback for a key never written', () => {
    expect(read('never-written', keep, [9])).toEqual([9]);
  });

  it('drops data written by an incompatible build rather than reading it', () => {
    // The trade this makes deliberately: losing a history list is a shrug, a
    // half-understood record that makes a screen throw is not.
    write(KEYS.history, [1, 2, 3]);
    storage.set(`${KEYS.history}.version`, SCHEMA_VERSION + 1);
    expect(read(KEYS.history, keep, [])).toEqual([]);
  });

  it('drops a value it cannot parse, and does not keep offering it', () => {
    storage.set(KEYS.presets, 'not json at all');
    storage.set(`${KEYS.presets}.version`, SCHEMA_VERSION);

    expect(read(KEYS.presets, keep, [])).toEqual([]);
    expect(storage.contains(KEYS.presets)).toBe(false);
  });

  it('drops a value the validator refuses', () => {
    write(KEYS.presets, { notAnArray: true });
    expect(read(KEYS.presets, keep, [])).toEqual([]);
    expect(storage.contains(KEYS.presets)).toBe(false);
  });

  it('forgets everything when asked, including the version markers', () => {
    // "Clear everything" that leaves a key behind is worse than not offering it.
    write(KEYS.history, [1]);
    write(KEYS.presets, [2]);
    write(KEYS.lastOptions, { quality: 70 });

    clearAll();

    expect(storage.getAllKeys()).toEqual([]);
  });
});
