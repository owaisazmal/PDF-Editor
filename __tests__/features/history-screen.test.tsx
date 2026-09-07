// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * What the device remembers, and the two-tap gate in front of forgetting it.
 *
 * History is metadata: counts, sizes and output names, never paths. That is what makes
 * clearing converted files at launch safe, so the shape is worth pinning here — a future
 * entry that started carrying a file path would make this screen a second place the app
 * keeps user data.
 */

import { fireEvent, screen } from '@testing-library/react-native';

import { HistoryScreen } from '@/features/history/HistoryScreen';
import { useHistoryStore, type HistoryEntry } from '@/store/history';
import { renderScreen, screenProps, t } from '../support/renderScreen';

jest.mock('@/native', () => require('../support/nativeMock').createNativeMock());

const entry = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: 'entry-1',
  at: Date.UTC(2026, 0, 15, 12, 0, 0),
  taskId: 'compress-image',
  targetFormat: 'jpeg',
  fileCount: 3,
  failedCount: 0,
  bytesBefore: 9_100_000,
  bytesAfter: 2_500_000,
  outputNames: ['IMG_0001.jpg', 'IMG_0002.jpg', 'IMG_0003.jpg'],
  ...over,
});

const render = () => renderScreen(<HistoryScreen {...screenProps('History', undefined)} />);

beforeEach(() => {
  useHistoryStore.setState({ entries: [] });
});

describe('with nothing recorded', () => {
  it('explains the emptiness rather than showing a bare list', async () => {
    await render();

    expect(screen.getByText(t('history.emptyTitle'))).toBeOnTheScreen();
  });

  it('offers no way to clear what is not there', async () => {
    await render();

    expect(screen.queryByText(t('history.clear'))).toBeNull();
  });
});

describe('with entries', () => {
  beforeEach(() => {
    useHistoryStore.setState({ entries: [entry()] });
  });

  it('names the task in the current language, not the one it was recorded in', async () => {
    useHistoryStore.setState({
      // A row from an older build, carrying a frozen English title alongside a task id
      // that is still known. The id must win, or switching language strands the row.
      entries: [entry({ taskTitle: 'Frozen English Title' })],
    });

    await render();

    expect(screen.queryByText('Frozen English Title')).toBeNull();
  });

  it('counts what was converted', async () => {
    await render();

    expect(screen.getByText(t('history.count', { count: 1 }))).toBeOnTheScreen();
  });
});

describe('clearing', () => {
  beforeEach(() => {
    useHistoryStore.setState({ entries: [entry()] });
  });

  it('asks once before doing it', async () => {
    await render();

    await fireEvent.press(screen.getByText(t('history.clear')));

    // Still there: the first press is the question, not the answer.
    expect(useHistoryStore.getState().entries).toHaveLength(1);
    expect(screen.getByText(t('history.clearConfirm'))).toBeOnTheScreen();
  });

  it('clears on the second press', async () => {
    await render();

    await fireEvent.press(screen.getByText(t('history.clear')));
    await fireEvent.press(screen.getByText(t('history.clearConfirm')));

    expect(useHistoryStore.getState().entries).toHaveLength(0);
  });
});

describe('what an entry is allowed to hold', () => {
  it('records names and counts, never a path back to a file', async () => {
    const recorded = entry();

    // Asserted on the type's own surface rather than on the screen: this is the rule
    // that lets the app delete converted files at launch without stranding anything.
    expect(Object.keys(recorded)).toEqual(
      expect.not.arrayContaining(['uri', 'outputUri', 'path', 'outputPath']),
    );
  });
});
