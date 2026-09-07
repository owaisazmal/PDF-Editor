// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The single-file path, from a picked file to a saved one.
 *
 * The states are asserted through what the screen offers rather than through the store's
 * `phase`, because the store having the right phase while the screen shows the wrong
 * buttons is exactly the class of bug a store test cannot see.
 */

import { screen } from '@testing-library/react-native';

import { ConvertScreen } from '@/features/convert/ConvertScreen';
import { useConversionStore } from '@/store/conversion';
import { conversionResult, detectedFile } from '../support/fixtures';
import { renderScreen, screenProps, t } from '../support/renderScreen';

jest.mock('@/native', () => require('../support/nativeMock').createNativeMock());
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

const TASK = 'heic-to-jpg';

const render = () => renderScreen(<ConvertScreen {...screenProps('Convert', { taskId: TASK })} />);

beforeEach(() => {
  useConversionStore.setState({
    phase: 'ready',
    source: detectedFile('heic'),
    result: null,
    failure: null,
  });
});

describe('before converting', () => {
  it('offers the conversion', async () => {
    await render();

    expect(screen.getByTestId('convert-button')).toBeOnTheScreen();
    expect(screen.queryByTestId('save-button')).toBeNull();
  });

  it('refuses to convert a file it could not identify', async () => {
    useConversionStore.setState({ source: detectedFile('') });

    await render();

    // Disabled rather than hidden: the button is the answer to "why can I not convert
    // this", and removing it leaves the question with nowhere to land.
    expect(screen.getByTestId('convert-button')).toBeDisabled();
  });
});

describe('after converting', () => {
  beforeEach(() => {
    useConversionStore.setState({ phase: 'done', result: conversionResult(), failure: null });
  });

  it('swaps the convert button for a save button', async () => {
    await render();

    expect(screen.getByTestId('save-button')).toBeOnTheScreen();
    expect(screen.queryByTestId('convert-button')).toBeNull();
  });

  it('reports the size before and after, which is the point of the screen', async () => {
    await render();

    // Queried by label rather than by text. `StatRow` hides its halves from
    // accessibility and exposes one combined label, so a screen reader hears
    // "Before: 2.4MB" rather than "Before" and "2.4MB" as two unrelated readings —
    // and a text query, which skips accessibility-hidden nodes, finds neither.
    expect(screen.getByLabelText(`${t('common.before')}: 2.4MB`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`${t('common.after')}: 780kB`)).toBeOnTheScreen();
  });

  it('announces the saving as a sentence rather than a label and a figure', async () => {
    await render();

    // 780kB from 2.4MB is a 68% saving. Spoken, because "Saved: 68%" read aloud leaves
    // the direction of the change to be worked out from two fragments — and with the
    // unit spelled out, because a screen reader given "%" says "percent sign" on iOS.
    expect(screen.getByLabelText('68 percent smaller')).toBeOnTheScreen();
  });
});

describe('when it fails', () => {
  it('explains the failure in words rather than a code', async () => {
    useConversionStore.setState({
      phase: 'error',
      result: null,
      failure: { code: 'unreadable', message: 'raw developer string' },
    });

    await render();

    expect(screen.getByText(t('convert.failed'))).toBeOnTheScreen();
    // The developer-facing message must never reach the screen untranslated.
    expect(screen.queryByText('raw developer string')).toBeNull();
  });
});
