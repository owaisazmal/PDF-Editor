// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Files handed over by another app, before a task has been chosen.
 *
 * The rule worth guarding is that a chosen task receives only the files it can read.
 * A share sheet routinely carries a mixed selection, and handing a PDF task the photo
 * that happened to be alongside is how a batch fails on a file the user never aimed
 * at it.
 */

import { fireEvent, screen } from '@testing-library/react-native';

import { IncomingScreen } from '@/features/incoming/IncomingScreen';
import { useIncomingStore } from '@/store/incoming';
import { useCapabilitiesStore } from '@/store/capabilities';
import type { FormatId } from '@/engine/formats';
import { detectedFile } from '../support/fixtures';
import { renderScreen, screenProps, stubNavigation, t } from '../support/renderScreen';

jest.mock('@/native', () => require('../support/nativeMock').createNativeMock());

const ALL_FORMATS: FormatId[] = ['heic', 'jpeg', 'png', 'webp', 'pdf', 'gif', 'bmp', 'tiff'];

function seedCapabilities() {
  useCapabilitiesStore.setState({
    decode: new Set(ALL_FORMATS),
    encode: new Set(ALL_FORMATS),
    pdfOperations: new Set(['compose', 'split', 'merge', 'rasterise', 'compress'] as never),
    isLoaded: true,
    error: null,
  });
}

const render = (navigation = stubNavigation()) =>
  renderScreen(<IncomingScreen {...screenProps('Incoming', undefined, navigation)} />);

beforeEach(() => {
  seedCapabilities();
  useIncomingStore.setState({ files: [] });
});

describe('listing what arrived', () => {
  it('names every file it was given', async () => {
    useIncomingStore.setState({
      files: [
        detectedFile('heic', { displayName: 'photo.heic' }),
        detectedFile('png', { displayName: 'diagram.png' }),
      ],
    });

    await render();

    // By label, not by text: `FileRow` hides its parts from accessibility and exposes one
    // combined reading, so a screen reader hears the name, state and size as a sentence.
    expect(screen.getByLabelText(/photo\.heic/)).toBeOnTheScreen();
    expect(screen.getByLabelText(/diagram\.png/)).toBeOnTheScreen();
  });

  it('flags the ones it could not identify instead of dropping them silently', async () => {
    useIncomingStore.setState({
      files: [
        detectedFile('heic', { displayName: 'photo.heic' }),
        detectedFile('', { displayName: 'mystery.dat' }),
      ],
    });

    await render();

    expect(screen.getByLabelText(/mystery\.dat/)).toBeOnTheScreen();
    expect(screen.getByText(t('incoming.unreadable', { count: 1 }))).toBeOnTheScreen();
  });
});

describe('choosing what to do', () => {
  it('offers something for a selection it understands', async () => {
    useIncomingStore.setState({ files: [detectedFile('heic')] });

    await render();

    expect(screen.getByText(t('incoming.whatToDo'))).toBeOnTheScreen();
  });

  it('offers nothing to do with a file it cannot read', async () => {
    useIncomingStore.setState({ files: [detectedFile('', { displayName: 'mystery.dat' })] });

    await render();

    expect(screen.queryByText(t('incoming.whatToDo'))).toBeNull();
  });

  it('empties the handover once a task takes the files', async () => {
    const navigation = stubNavigation();
    useIncomingStore.setState({ files: [detectedFile('heic')] });

    await render(navigation);
    await fireEvent.press(screen.getByText(t('tasks.heic-to-jpg.title')));

    // Cleared before navigating: the files belong to the task's own store now, and
    // leaving them here means landing back on this screen after finishing.
    expect(useIncomingStore.getState().files).toHaveLength(0);
    expect(navigation.navigate).toHaveBeenCalled();
  });
});
