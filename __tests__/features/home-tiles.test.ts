// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Regression guard for a bug that made the app unusable.
 *
 * The home screen used to disable every tile while any pick was in flight. A native
 * picker dismissed in a way its delegate never observed left the promise unresolved,
 * so the `finally` that clears the busy flag never ran — and the whole grid stayed
 * dead until the app was relaunched, with no path back from inside the app.
 *
 * The fix has two halves: Swift now guarantees its picker continuation resumes exactly
 * once, and the enabled rule is strictly per-tile. This covers the second half.
 */

import en from '@/i18n/locales/en.json';
import {
  CONVERSION_TASKS,
  CURRENT_PHASE,
  isTaskAvailable,
  isTaskSupported,
  isTileInteractive,
  unavailableReason,
  type ConversionTask,
} from '@/features/home/tasks';

const available = CONVERSION_TASKS.filter(isTaskAvailable);
const heicToJpg = CONVERSION_TASKS.find((t) => t.id === 'heic-to-jpg')!;

describe('tile interactivity', () => {
  it('has at least one available task, or the rest of this file proves nothing', () => {
    expect(available.length).toBeGreaterThan(0);
  });

  it('makes every available task interactive when nothing is in flight', () => {
    for (const task of available) {
      expect(isTileInteractive(task, null)).toBe(true);
    }
  });

  it('dims only the tile whose pick is outstanding', () => {
    expect(isTileInteractive(heicToJpg, heicToJpg.id)).toBe(false);

    // The heart of the regression: every OTHER available tile stays live.
    for (const task of available.filter((t) => t.id !== heicToJpg.id)) {
      expect(isTileInteractive(task, heicToJpg.id)).toBe(true);
    }
  });

  it('never makes an unavailable task interactive, busy or not', () => {
    for (const task of CONVERSION_TASKS.filter((t) => !isTaskAvailable(t))) {
      expect(isTileInteractive(task, null)).toBe(false);
      expect(isTileInteractive(task, heicToJpg.id)).toBe(false);
    }
  });

  it('does not brick the grid for an id that matches no tile', () => {
    // A stale busy id must not be able to disable anything.
    for (const task of available) {
      expect(isTileInteractive(task, 'a-task-that-no-longer-exists')).toBe(true);
    }
  });
});

describe('capability gating', () => {
  const loaded = (decode: string[], encode: string[], pdfOperations: string[] = []) => ({
    decode: new Set(decode) as never,
    encode: new Set(encode) as never,
    pdfOperations: new Set(pdfOperations) as never,
    isLoaded: true,
  });

  const heicToJpg = CONVERSION_TASKS.find((t) => t.id === 'heic-to-jpg')!;

  it('is optimistic before the report lands, rather than flashing unsupported', () => {
    const pending = {
    decode: new Set() as never,
    encode: new Set() as never,
    pdfOperations: new Set() as never,
    isLoaded: false,
  };
    expect(isTaskSupported(heicToJpg, pending)).toBe(true);
    expect(unavailableReason(heicToJpg, pending)).toBeNull();
  });

  it('closes a task the device cannot decode the source of', () => {
    // Android below API 28 is exactly this: JPEG in, JPEG out, no HEIC decoder.
    const noHeic = loaded(['jpeg', 'png'], ['jpeg', 'png']);
    expect(isTaskSupported(heicToJpg, noHeic)).toBe(false);
    // The identifier rather than the sentence: this asserts which of the four reasons
    // the user is given, and keeps asserting it after the sentence is reworded.
    expect(unavailableReason(heicToJpg, noHeic)).toBe('device');
  });

  it('closes a task the device cannot encode the target of', () => {
    const noJpegEncoder = loaded(['heic', 'jpeg'], ['png']);
    expect(isTaskSupported(heicToJpg, noJpegEncoder)).toBe(false);
  });

  it('opens a task the device can do both halves of', () => {
    expect(isTaskSupported(heicToJpg, loaded(['heic'], ['jpeg']))).toBe(true);
  });

  it('distinguishes "not built yet" from "your device cannot"', () => {
    const capable = loaded(
      ['jpeg', 'png', 'heic', 'webp', 'pdf'],
      ['jpeg', 'png', 'webp', 'pdf'],
      ['inspect', 'render', 'compose', 'compress', 'merge', 'split', 'edit', 'unlock'],
    );
    // Synthetic rather than found in the list. Once the last phase opens there is no
    // real task left beyond it, and a test that quietly stops asserting anything is
    // worse than no test — this one has to keep failing if the rule breaks.
    const notBuilt = {
      ...CONVERSION_TASKS[0]!,
      id: 'a-later-tile',
      phase: (CURRENT_PHASE + 1) as ConversionTask['phase'],
    };
    // Telling a user their phone cannot do something we simply have not written is how
    // a bug report gets filed against the phone.
    expect(unavailableReason(notBuilt, capable)).toBe('later');

    // The settings screen now exists, so the tasks that were waiting on it are open.
    // Kept as an assertion rather than deleted: if HAS_TRANSFORM_OPTIONS is ever
    // flipped back, this is the test that says what that costs the user.
    const needsSettings = CONVERSION_TASKS.find((t) => t.needsOptions)!;
    expect(unavailableReason(needsSettings, capable)).toBeNull();
  });

  it('blames the build, not the phone, for a PDF operation this platform lacks', () => {
    // Android reads and writes PDF and still cannot move a page between two of them.
    // "Not supported on this device" would be the wrong claim about a working phone.
    const noMerge = loaded(
      ['jpeg', 'png', 'heic', 'webp', 'pdf'],
      ['jpeg', 'png', 'webp', 'pdf'],
      ['inspect', 'render', 'compose', 'compress', 'split'],
    );
    const mergePdf = CONVERSION_TASKS.find((t) => t.id === 'merge-pdf')!;
    expect(unavailableReason(mergePdf, noMerge)).toBe('platform');
  });

  it('keeps a device-unsupported tile non-interactive even when nothing is busy', () => {
    expect(isTileInteractive(heicToJpg, null, loaded(['jpeg'], ['jpeg']))).toBe(false);
  });
});

/**
 * A tile's words are looked up from its id — `tasks.<id>.title` — so nothing the compiler
 * can see joins the two. Rename a task or add one and the home screen renders
 * `tasks.split-pdf.title` at full size, which only someone reading the grid would catch.
 */
describe('every tile has words in the catalogue', () => {
  const catalogue: Record<string, unknown> = en.tasks;

  /**
   * What a tile's entry looks like, rather than a list of the keys that are not one.
   * `tasks` also holds strings every tile shares, and a new one of those is not a
   * regression — an entry with a title and no tile behind it is.
   */
  const isTileEntry = (value: unknown): boolean =>
    typeof (value as { title?: unknown } | undefined)?.title === 'string';

  it.each(CONVERSION_TASKS.map((task) => task.id))('%s has a title and a subtitle', (id) => {
    const entry = catalogue[id] as { title?: unknown; subtitle?: unknown } | undefined;
    expect(typeof entry?.title).toBe('string');
    expect(entry?.title).not.toBe('');
    expect(typeof entry?.subtitle).toBe('string');
    expect(entry?.subtitle).not.toBe('');
  });

  it('carries no words for a tile that does not exist', () => {
    // The same rot in the other direction: a title nobody renders, paid for nine times
    // over and wrong in every one of them without anybody finding out.
    const ids = new Set(CONVERSION_TASKS.map((task) => task.id));
    const orphans = Object.entries(catalogue)
      .filter(([key, value]) => isTileEntry(value) && !ids.has(key))
      .map(([key]) => key);
    expect(orphans).toEqual([]);
  });

  it('names every reason a tile can be closed', () => {
    // `UnavailableReason` is exactly the set of `home.unavailable.*` keys. The compiler
    // holds one end of that promise and this holds the other.
    expect(Object.keys(en.home.unavailable).sort()).toEqual([
      'device',
      'later',
      'platform',
      'settings',
    ]);
  });
});
