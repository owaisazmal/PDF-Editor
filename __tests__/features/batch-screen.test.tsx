// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The many-file path: progress while it runs, and what is offered when it stops.
 *
 * The cancel button is the reason the job queue lives in native code, so the assertion
 * that matters is not that the button renders but that pressing it reaches the store's
 * `cancel`. A cancel control wired to nothing is indistinguishable from a working one
 * until a batch is actually running.
 */

import { fireEvent, screen } from '@testing-library/react-native';

import { BatchScreen } from '@/features/batch/BatchScreen';
import { useBatchStore } from '@/store/batch';
import type { JobProgress } from '@/native/types';
import { conversionResult, detectedFile } from '../support/fixtures';
import { renderScreen, screenProps, t } from '../support/renderScreen';

jest.mock('@/native', () => require('../support/nativeMock').createNativeMock());

/**
 * The progress bar animates its width, and `useNativeDriver: false` means the tween runs
 * on JS timers that keep firing after a test's last assertion — each frame a state update
 * outside `act`, which React reports as a warning against whichever test was unlucky
 * enough to still be running. Reduced motion is a real supported mode, so rendering in it
 * here is not a special case invented for the tests.
 */
jest.mock('@/utils/useReducedMotion', () => ({ useReducedMotion: () => true }));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

const TASK = 'compress-image';

const sources = [
  detectedFile('heic', { displayName: 'IMG_0001.heic' }),
  detectedFile('heic', { displayName: 'IMG_0002.heic' }),
  detectedFile('heic', { displayName: 'IMG_0003.heic' }),
];

const progress = (over: Partial<JobProgress> = {}): JobProgress => ({
  jobId: 'job-1',
  completedCount: 1,
  failedCount: 0,
  totalCount: 3,
  fraction: 0.33,
  currentDisplayName: 'IMG_0002.heic',
  ...over,
});

const render = () => renderScreen(<BatchScreen {...screenProps('Batch', { taskId: TASK })} />);

/** Replaces the store's action with a spy, leaving the rest of the state alone. */
function spyOnAction(name: 'cancel' | 'retryFailed') {
  const spy = jest.fn().mockResolvedValue(undefined);
  useBatchStore.setState({ [name]: spy } as never);
  return spy;
}

beforeEach(() => {
  useBatchStore.setState({
    jobId: 'job-1',
    sources,
    status: 'running',
    progress: progress(),
    results: [],
    failures: [],
    submitErrorKey: null,
  });
});

describe('while it runs', () => {
  it('offers cancel, and nothing that implies the batch is over', async () => {
    await render();

    expect(screen.getByTestId('cancel-button')).toBeOnTheScreen();
    expect(screen.queryByTestId('save-button')).toBeNull();
  });

  it('actually cancels, rather than only looking like it does', async () => {
    const cancel = spyOnAction('cancel');
    await render();

    await fireEvent.press(screen.getByTestId('cancel-button'));

    expect(cancel).toHaveBeenCalled();
  });

  it('names the file being worked on, so progress is legible without a count', async () => {
    await render();

    expect(screen.getByText('IMG_0002.heic')).toBeOnTheScreen();
  });

  it('says it is cancelling once asked, rather than appearing to have stalled', async () => {
    useBatchStore.setState({ status: 'cancelling' });

    await render();

    expect(screen.getByText(t('batch.finishingCurrent'))).toBeOnTheScreen();
  });
});

describe('when it finishes', () => {
  beforeEach(() => {
    useBatchStore.setState({
      status: 'completed',
      progress: progress({ completedCount: 3, fraction: 1, currentDisplayName: '' }),
      results: [0, 1, 2].map((i) => conversionResult({ sourceIndex: i })),
    });
  });

  it('offers to save everything it produced', async () => {
    await render();

    expect(screen.getByTestId('save-button')).toBeOnTheScreen();
    expect(screen.queryByTestId('cancel-button')).toBeNull();
  });

  it('offers no retry when nothing failed', async () => {
    await render();

    expect(screen.queryByTestId('retry-button')).toBeNull();
  });
});

describe('when some files fail', () => {
  beforeEach(() => {
    useBatchStore.setState({
      status: 'completed',
      progress: progress({ completedCount: 2, failedCount: 1, fraction: 1 }),
      results: [conversionResult({ sourceIndex: 0 }), conversionResult({ sourceIndex: 1 })],
      failures: [
        {
          sourceIndex: 2,
          uri: 'file:///tmp/IMG_0003.heic',
          displayName: 'IMG_0003.heic',
          code: 'unreadable',
          message: 'raw developer string',
        },
      ],
    });
  });

  it('offers to retry only the ones that failed', async () => {
    await render();

    expect(screen.getByTestId('retry-button')).toBeOnTheScreen();
    // Saving stays available: the files that did convert are real, and withholding them
    // until every file succeeds punishes the user for one unreadable photo.
    expect(screen.getByTestId('save-button')).toBeOnTheScreen();
  });

  it('retries through the store', async () => {
    const retry = spyOnAction('retryFailed');
    await render();

    await fireEvent.press(screen.getByTestId('retry-button'));

    expect(retry).toHaveBeenCalled();
  });

  it('never shows the developer-facing failure message', async () => {
    await render();

    expect(screen.queryByText('raw developer string')).toBeNull();
  });
});
