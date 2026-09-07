// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The settings screen, and the two promises it makes on the app's behalf.
 *
 * The appearance control is the only preference in the product that survives a relaunch,
 * so it is the only one where a broken write is invisible until someone reopens the app.
 * The colophon below it is a factual claim about what the app does with data; it is
 * asserted here so that deleting the string is a test failure rather than a quiet edit.
 */

import { Linking } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';

import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { APPEARANCE_MODES, DEFAULT_MODE, useAppearanceStore } from '@/store/appearance';
import { renderScreen, screenProps, stubNavigation, t } from '../support/renderScreen';

// Spied rather than `jest.mock('react-native', ...)`. Spreading the real module to
// override one member forces every lazy native getter on it to evaluate, and several of
// them throw outside an app — the mock takes the whole suite down before a test runs.
let openURL: jest.SpiedFunction<typeof Linking.openURL>;
let openSettings: jest.SpiedFunction<typeof Linking.openSettings>;

beforeEach(() => {
  useAppearanceStore.setState({ mode: DEFAULT_MODE });
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('appearance', () => {
  it('starts on light, which is the scheme the palette was drawn for', async () => {
    await renderScreen(<SettingsScreen {...screenProps('Settings', undefined)} />);

    expect(screen.getByTestId('appearance-light')).toBeSelected();
    expect(screen.getByTestId('appearance-dark')).not.toBeSelected();
  });

  it('offers every mode the store knows about, so neither list can drift', async () => {
    await renderScreen(<SettingsScreen {...screenProps('Settings', undefined)} />);

    for (const mode of APPEARANCE_MODES) {
      expect(screen.getByTestId(`appearance-${mode}`)).toBeOnTheScreen();
    }
  });

  it.each(APPEARANCE_MODES)('commits %s to the store, not just to the control', async (mode) => {
    await renderScreen(<SettingsScreen {...screenProps('Settings', undefined)} />);

    await fireEvent.press(screen.getByTestId(`appearance-${mode}`));

    // The store rather than the rendered fill: a control that highlights the tapped
    // segment while writing nothing looks correct and forgets the choice on relaunch.
    expect(useAppearanceStore.getState().mode).toBe(mode);
  });

  it('moves the selection to the tapped segment', async () => {
    await renderScreen(<SettingsScreen {...screenProps('Settings', undefined)} />);

    await fireEvent.press(screen.getByTestId('appearance-dark'));

    expect(screen.getByTestId('appearance-dark')).toBeSelected();
    expect(screen.getByTestId('appearance-light')).not.toBeSelected();
  });
});

describe('about', () => {
  it('shows the version a bug report would quote', async () => {
    await renderScreen(<SettingsScreen {...screenProps('Settings', undefined)} />);

    // Asserted as non-empty rather than pinned to a number, so a release bump is not a
    // test failure — the regression this guards is the label rendering with nothing in it.
    expect(screen.getByTestId('about-version')).toHaveTextContent(/\d+\.\d+/);
  });

  it('states the attribution and the licence exactly, both being legal identifiers', async () => {
    await renderScreen(<SettingsScreen {...screenProps('Settings', undefined)} />);

    expect(screen.getByText(/Copyright \(c\) 2026 Owais Khan/)).toBeOnTheScreen();
    expect(screen.getByText(/Apache License, Version 2\.0/)).toBeOnTheScreen();
  });

  it('keeps the no-data claim on screen', async () => {
    await renderScreen(<SettingsScreen {...screenProps('Settings', undefined)} />);

    // The screen is where the claim is made to the user, so the string existing in the
    // catalogue is not enough: it has to be rendered.
    expect(screen.getByText(t('settings.privacy'))).toBeOnTheScreen();
  });

  it('opens the source link rather than navigating inside the app', async () => {
    await renderScreen(<SettingsScreen {...screenProps('Settings', undefined)} />);

    await fireEvent.press(screen.getByTestId('open-source'));

    expect(openURL).toHaveBeenCalledWith(expect.stringContaining('github.com'));
  });
});

describe('language', () => {
  it('sends the user to the system settings, there being no picker of our own', async () => {
    await renderScreen(<SettingsScreen {...screenProps('Settings', undefined)} />);

    await fireEvent.press(screen.getByTestId('open-system-settings'));

    expect(openSettings).toHaveBeenCalled();
  });
});

describe('licences', () => {
  it('reaches the licences screen, which is how the notices are conveyed', async () => {
    const navigation = stubNavigation();
    await renderScreen(<SettingsScreen {...screenProps('Settings', undefined, navigation)} />);

    await fireEvent.press(screen.getByTestId('open-licenses'));

    expect(navigation.navigate).toHaveBeenCalledWith('Licenses');
  });
});
