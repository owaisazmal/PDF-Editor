// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * That the settings a user chooses reach the engine.
 *
 * Worth a test of its own because the absence of one was expensive. Both screens that
 * submit work used to build an options object from scratch, so every control on the
 * settings screen was read back to the user, remembered across launches, used to compute a
 * real size estimate, and then discarded. The suite was green throughout: nothing asserted
 * that the thing the user picked was the thing that ran.
 */

import { defaultOptionsFor, optionsForTask, useOptionsStore } from '@/store/options';

const RESET = defaultOptionsFor('jpeg');

beforeEach(() => {
  useOptionsStore.setState({ options: RESET });
});

describe('the options a task converts with', () => {
  it('uses what the user chose, for a task that offers a choice', () => {
    useOptionsStore.setState({
      options: {
        ...RESET,
        quality: 40,
        targetByteSize: 500_000,
        rotate: 90,
        metadata: { mode: 'stripAll' },
      },
    });

    const options = optionsForTask({ targetFormat: 'jpeg', needsOptions: true });

    expect(options.quality).toBe(40);
    expect(options.targetByteSize).toBe(500_000);
    expect(options.rotate).toBe(90);
    expect(options.metadata).toEqual({ mode: 'stripAll' });
  });

  it('carries a resize preset through, which is the whole point of Resize Image', () => {
    useOptionsStore.setState({
      options: {
        ...RESET,
        resize: {
          mode: 'maxDimension',
          maxWidth: 1080,
          maxHeight: 1080,
          percent: 100,
          exactWidth: 0,
          exactHeight: 0,
          allowUpscale: false,
        },
      },
    });

    expect(optionsForTask({ targetFormat: 'jpeg', needsOptions: true }).resize).toMatchObject({
      mode: 'maxDimension',
      maxWidth: 1080,
      maxHeight: 1080,
    });
  });

  it('carries the chosen background, which is the whole point of PNG to JPG', () => {
    useOptionsStore.setState({ options: { ...RESET, background: { color: '#000000' } } });

    expect(optionsForTask({ targetFormat: 'jpeg', needsOptions: true }).background).toEqual({
      color: '#000000',
    });
  });

  /**
   * A three-tap conversion must not inherit a setting from an unrelated job. Someone
   * tapping "HEIC to JPG" has not asked for the 1080p preset they picked last week.
   */
  it('ignores stored settings for a task that offers no choice', () => {
    useOptionsStore.setState({ options: { ...RESET, quality: 40, rotate: 180 } });

    const options = optionsForTask({ targetFormat: 'jpeg' });

    expect(options.quality).toBe(RESET.quality);
    expect(options.rotate).toBe(0);
  });

  it('always takes the target format from the task, never from the store', () => {
    useOptionsStore.setState({ options: { ...RESET, targetFormat: 'png' } });

    expect(optionsForTask({ targetFormat: 'jpeg', needsOptions: true }).targetFormat).toBe('jpeg');
    expect(optionsForTask({ targetFormat: 'webp' }).targetFormat).toBe('webp');
  });
});
