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

import { CONVERSION_TASKS, isTileInteractive, isTaskAvailable } from '@/features/home/tasks';

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
