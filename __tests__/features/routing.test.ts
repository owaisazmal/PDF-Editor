// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Where a picked or shared selection lands, and what the destination reads when it gets
 * there. Both bugs pinned here passed every screen test, because each screen was rendered
 * with freshly seeded stores; they only showed up on a device, one task after another.
 */

import { routeToTask, type TaskNavigation } from '@/features/home/routing';
import { CONVERSION_TASKS } from '@/features/home/tasks';
import { useBatchStore } from '@/store/batch';
import { useConversionStore } from '@/store/conversion';
import { detectedFile } from '../support/fixtures';

jest.mock('@/native', () => require('../support/nativeMock').createNativeMock());

const task = (id: string) => CONVERSION_TASKS.find((candidate) => candidate.id === id)!;

const navigation = (): TaskNavigation & { navigate: jest.Mock } => ({ navigate: jest.fn() });

beforeEach(() => {
  useConversionStore.getState().reset();
  useBatchStore.getState().reset();
});

describe('a batch picked after a single conversion', () => {
  it('is not replaced by the file from the earlier conversion', () => {
    // A single conversion left through the back gesture keeps its source in the store.
    useConversionStore.getState().setSource(detectedFile('jpeg', { displayName: 'old.jpg' }));
    const picked = [
      detectedFile('jpeg', { displayName: 'a.jpg' }),
      detectedFile('jpeg', { displayName: 'b.jpg' }),
      detectedFile('jpeg', { displayName: 'c.jpg' }),
    ];
    const nav = navigation();

    routeToTask(nav, task('compress-image'), picked);

    // The options screen counts `conversionSource ? 1 : batchSources.length`, so a
    // leftover source made this read "1 file" and converted old.jpg.
    expect(useConversionStore.getState().source).toBeNull();
    expect(useBatchStore.getState().sources).toEqual(picked);
    expect(nav.navigate).toHaveBeenCalledWith('Options', { taskId: 'compress-image' });
  });
});

describe('PNG to JPG', () => {
  it('opens the options screen, where its background colour is chosen', () => {
    const nav = navigation();

    routeToTask(nav, task('png-to-jpg'), [detectedFile('png')]);

    expect(nav.navigate).toHaveBeenCalledWith('Options', { taskId: 'png-to-jpg' });
  });

  it('does the same for a batch', () => {
    const nav = navigation();

    routeToTask(nav, task('png-to-jpg'), [detectedFile('png'), detectedFile('png')]);

    expect(nav.navigate).toHaveBeenCalledWith('Options', { taskId: 'png-to-jpg' });
  });
});
