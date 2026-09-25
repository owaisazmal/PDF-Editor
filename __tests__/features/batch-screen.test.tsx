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

import { Alert } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { BatchScreen } from '@/features/batch/BatchScreen';
import { fileGateway } from '@/native';
import { useBatchStore } from '@/store/batch';
import type { JobProgress } from '@/native/types';
import { conversionResult, detectedFile } from '../support/fixtures';
import { renderScreen, screenProps, stubNavigation, t } from '../support/renderScreen';

jest.mock('@/native', () => require('../support/nativeMock').createNativeMock());

// Rendered without a navigator; the leave guard is exercised through the captured callback.
const mockPreventRemove = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  usePreventRemove: (...args: unknown[]) => mockPreventRemove(...args),
}));

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
function spyOnAction(name: 'cancel' | 'retryFailed' | 'restart') {
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

  it('asks before leaving, and stops the batch when the user leaves anyway', async () => {
    const restart = spyOnAction('restart');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const navigation = { ...stubNavigation(), dispatch: jest.fn() };
    await renderScreen(<BatchScreen {...screenProps('Batch', { taskId: TASK }, navigation)} />);

    const [prevent, onLeave] = mockPreventRemove.mock.calls.at(-1)!;
    expect(prevent).toBe(true);
    const action = { type: 'GO_BACK' };
    onLeave({ data: { action } });
    const buttons = alert.mock.calls.at(-1)![2]!;
    buttons.find((button) => button.style === 'destructive')!.onPress!();

    expect(navigation.dispatch).toHaveBeenCalledWith(action);
    expect(restart).toHaveBeenCalled();
    alert.mockRestore();
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

  it('lets the user leave without asking', async () => {
    await render();

    expect(mockPreventRemove.mock.calls.at(-1)![0]).toBe(false);
  });
});

describe('saving after a retry', () => {
  const output = (i: number) => conversionResult({ sourceIndex: i, outputUri: `file:///out/${i}.jpg` });

  it('saves only the files the retry added', async () => {
    const save = fileGateway.saveToPhotos as jest.Mock;
    save.mockClear();
    useBatchStore.setState({ status: 'completed', results: [output(0), output(1)] });
    await render();

    await fireEvent.press(screen.getByTestId('save-button'));
    await act(() => useBatchStore.setState({ results: [output(0), output(1), output(2)] }));
    await screen.findByText(t('batch.saveAll', { count: 1 }));
    await fireEvent.press(screen.getByTestId('save-button'));

    expect(save.mock.calls).toEqual([
      [['file:///out/0.jpg', 'file:///out/1.jpg']],
      [['file:///out/2.jpg']],
    ]);
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

describe('when it was stopped', () => {
  it('says nothing was converted, rather than "the 0 files already converted are below"', async () => {
    useBatchStore.setState({ status: 'cancelled', results: [], progress: progress({ completedCount: 0 }) });

    await render();

    expect(screen.getByText(t('batch.stoppedNone'))).toBeOnTheScreen();
  });

  it('compares sizes for the converted files only', async () => {
    useBatchStore.setState({
      status: 'cancelled',
      results: [conversionResult({ sourceIndex: 0, byteSize: 780_000 })],
    });

    await render();

    // One 2.4MB source converted, not all three (7.2MB).
    expect(screen.getByLabelText(`${t('common.before')}: 2.4MB`)).toBeOnTheScreen();
  });

  it('points at the files it did convert', async () => {
    useBatchStore.setState({ status: 'cancelled', results: [conversionResult({ sourceIndex: 0 })] });

    await render();

    expect(screen.getByText(t('batch.stopped', { count: 1 }))).toBeOnTheScreen();
  });
});
