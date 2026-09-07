// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Every PDF task shares this screen; the task id decides which controls appear.
 *
 * That sharing is the thing worth testing. One screen serving five operations means a
 * control shown for the wrong task is a plausible mistake rather than an obvious one,
 * and the reordering controls in particular exist because a merge with the pages in the
 * wrong order is a silent failure: it produces a valid PDF that is simply wrong.
 */

import { fireEvent, screen } from '@testing-library/react-native';

import { PdfScreen } from '@/features/pdf/PdfScreen';
import { usePdfStore } from '@/store/pdf';
import { detectedFile } from '../support/fixtures';
import { renderScreen, screenProps, t } from '../support/renderScreen';

jest.mock('@/native', () => require('../support/nativeMock').createNativeMock());
jest.mock('@/utils/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

const pdfs = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    detectedFile('pdf', { displayName: `doc-${i + 1}.pdf`, pageCount: 4 }),
  );

const images = (count: number) =>
  Array.from({ length: count }, (_, i) => detectedFile('jpeg', { displayName: `IMG_000${i}.jpg` }));

const render = (taskId: string) =>
  renderScreen(<PdfScreen {...screenProps('Pdf', { taskId })} />);

function seed(sources: ReturnType<typeof pdfs>) {
  usePdfStore.setState({
    sources,
    info: null,
    sessionHandle: '',
    status: 'idle',
    errorKey: null,
    passwordFailed: false,
    documents: [],
    images: [],
    parts: [],
    elapsedMs: 0,
  });
}

describe('image to PDF', () => {
  beforeEach(() => seed(images(3)));

  it('offers a page size, which is the choice that defines the output', async () => {
    await render('image-to-pdf');

    expect(screen.getByTestId('page-size-a4')).toBeOnTheScreen();
    expect(screen.getByTestId('page-size-fit')).toBeOnTheScreen();
  });

  it('hides orientation until a fixed page size makes it meaningful', async () => {
    await render('image-to-pdf');

    // "Fit image" is the default, and a page shaped like its image has no orientation
    // to choose. Showing the control anyway invites a setting that does nothing.
    expect(screen.queryByTestId('orientation')).toBeNull();

    await fireEvent.press(screen.getByTestId('page-size-a4'));

    expect(screen.getByTestId('orientation')).toBeOnTheScreen();
    expect(screen.getByTestId('fit')).toBeOnTheScreen();
  });

  it('offers the multi-up layouts', async () => {
    await render('image-to-pdf');

    expect(screen.getByTestId('n-up-1')).toBeOnTheScreen();
    expect(screen.getByTestId('n-up-2')).toBeOnTheScreen();
  });
});

describe('merge', () => {
  beforeEach(() => seed(pdfs(3)));

  it('lets every document move except at the ends', async () => {
    await render('merge-pdf');

    expect(screen.getByTestId('move-up-0')).toBeDisabled();
    expect(screen.getByTestId('move-down-0')).toBeEnabled();
    expect(screen.getByTestId('move-up-2')).toBeEnabled();
    expect(screen.getByTestId('move-down-2')).toBeDisabled();
  });

  it('actually reorders, a merge in the wrong order being a silent failure', async () => {
    await render('merge-pdf');

    await fireEvent.press(screen.getByTestId('move-down-0'));

    const names = usePdfStore.getState().sources.map((s) => s.displayName);
    expect(names).toEqual(['doc-2.pdf', 'doc-1.pdf', 'doc-3.pdf']);
  });
});

describe('split', () => {
  beforeEach(() => seed(pdfs(1)));

  it('offers a way to say how to split, and none of the merge ordering', async () => {
    await render('split-pdf');

    expect(screen.getByTestId('split-by')).toBeOnTheScreen();
    expect(screen.queryByTestId('move-up-0')).toBeNull();
  });
});

describe('PDF to JPG', () => {
  beforeEach(() => seed(pdfs(1)));

  it('offers the output format and a page selection', async () => {
    await render('pdf-to-jpg');

    expect(screen.getByTestId('format')).toBeOnTheScreen();
    expect(screen.getByTestId('page-ranges')).toBeOnTheScreen();
  });

  it('offers a DPI, the setting that decides whether the output is readable', async () => {
    await render('pdf-to-jpg');

    expect(screen.getByTestId('dpi-150')).toBeOnTheScreen();
  });
});

describe('a task this screen does not serve', () => {
  it('says there is nothing to do rather than rendering an empty shell', async () => {
    seed(pdfs(1));

    // The guard is on the task id, not on the file list: every PDF task shares this
    // screen, so an id that matches none of them is the case that has no controls to
    // draw at all. An empty selection is a different state, handled by disabling the
    // action below.
    await render('not-a-real-task');

    expect(screen.getByText(t('pdf.nothingToDo'))).toBeOnTheScreen();
  });
});
