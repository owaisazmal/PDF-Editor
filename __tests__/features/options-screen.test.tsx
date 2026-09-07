// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The screen that was entirely decorative.
 *
 * Every control here rendered, highlighted on tap and animated correctly while writing
 * nothing that reached a conversion. It passed 313 green tests, because all of them
 * tested the store and the engine separately and nothing tested the wire between them.
 * The bug was found by converting a file on a device and looking at the result.
 *
 * So these assertions are deliberately made against the store rather than against the
 * rendered control. A segment that highlights itself proves the segment works; only the
 * store proves the choice survived the screen.
 */

import { fireEvent, screen } from '@testing-library/react-native';

import { OptionsScreen } from '@/features/options/OptionsScreen';
import { optionsForTask, useOptionsStore } from '@/store/options';
import { useConversionStore } from '@/store/conversion';
import { useBatchStore } from '@/store/batch';
import { detectedFile } from '../support/fixtures';
import { renderScreen, screenProps, stubNavigation } from '../support/renderScreen';

jest.mock('@/native', () => require('../support/nativeMock').createNativeMock());

const COMPRESS = 'compress-image';

function seedSingle() {
  useConversionStore.setState({ source: detectedFile('heic'), result: null });
  useBatchStore.setState({ sources: [] });
}

function seedBatch(count: number) {
  useConversionStore.setState({ source: null, result: null });
  useBatchStore.setState({
    sources: Array.from({ length: count }, (_, i) => detectedFile('heic', { displayName: `IMG_000${i}.heic` })),
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  useOptionsStore.getState().replace(useOptionsStore.getState().options);
  useOptionsStore.setState((state) => ({
    options: { ...state.options, rotate: 0, quality: 82, metadata: { mode: 'keepExceptGps' } },
  }));
  seedSingle();
});

afterEach(() => {
  jest.useRealTimers();
});

const render = () =>
  renderScreen(<OptionsScreen {...screenProps('Options', { taskId: COMPRESS })} />);

describe('choices reaching the store', () => {
  it('writes a rotation the conversion will actually apply', async () => {
    await render();

    await fireEvent.press(screen.getByTestId('rotate-90'));

    expect(useOptionsStore.getState().options.rotate).toBe(90);
  });

  it('writes a metadata mode', async () => {
    await render();

    await fireEvent.press(screen.getByTestId('metadata-stripAll'));

    expect(useOptionsStore.getState().options.metadata?.mode).toBe('stripAll');
  });

  it('carries the choice through to what the conversion is handed', async () => {
    await render();

    await fireEvent.press(screen.getByTestId('rotate-180'));

    // The end of the wire. `optionsForTask` is what the convert and batch screens call,
    // so this is the assertion that would have failed on the decorative version.
    const task = { targetFormat: 'jpeg' as const, needsOptions: true };
    expect(optionsForTask(task).rotate).toBe(180);
  });
});

describe('leaving the screen', () => {
  it('sends a single file to the single-file screen', async () => {
    const navigation = stubNavigation();
    seedSingle();
    await renderScreen(
      <OptionsScreen {...screenProps('Options', { taskId: COMPRESS }, navigation)} />,
    );

    await fireEvent.press(screen.getByTestId('convert-with-options'));

    expect(navigation.navigate).toHaveBeenCalledWith('Convert', { taskId: COMPRESS });
  });

  it('sends several files to the batch screen', async () => {
    const navigation = stubNavigation();
    seedBatch(3);
    await renderScreen(
      <OptionsScreen {...screenProps('Options', { taskId: COMPRESS }, navigation)} />,
    );

    await fireEvent.press(screen.getByTestId('convert-with-options'));

    expect(navigation.navigate).toHaveBeenCalledWith('Batch', { taskId: COMPRESS });
  });
});

describe('nothing to work on', () => {
  it('says so rather than rendering controls over no file', async () => {
    useConversionStore.setState({ source: null, result: null });
    useBatchStore.setState({ sources: [] });

    await render();

    expect(screen.queryByTestId('convert-with-options')).toBeNull();
  });
});
