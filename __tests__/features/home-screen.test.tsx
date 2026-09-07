// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The first screen, rendered.
 *
 * `home-tiles.test.ts` covers the rules this screen applies — which tasks are available,
 * which tiles stay live during a pick, how many columns a window gets. This file covers
 * the screen actually drawing them, which is the part those rules cannot prove: the grid
 * was once a correct set of tasks rendered into a header that had no way to reach
 * settings, and a rule test is green either way.
 */

import { fireEvent, screen } from '@testing-library/react-native';

import { HomeScreen } from '@/features/home/HomeScreen';
import { CONVERSION_TASKS, isTaskAvailable } from '@/features/home/tasks';
import { useHistoryStore } from '@/store/history';
import { useCapabilitiesStore } from '@/store/capabilities';
import type { FormatId } from '@/engine/formats';
import { renderScreen, screenProps, stubNavigation, t } from '../support/renderScreen';

jest.mock('@/native', () => require('../support/nativeMock').createNativeMock());

/**
 * `useFocusEffect` reads the navigator from React context, not from the `navigation` prop,
 * so a screen rendered on its own throws before it draws anything. Standing in `useEffect`
 * is faithful rather than convenient: focus is exactly the state a screen under test is
 * in, and HomeScreen already wraps its callback in `useCallback`, which is what makes the
 * dependency stable enough for the substitution to behave the same way.
 */
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: (callback: () => void | (() => void)) =>
    require('react').useEffect(callback, [callback]),
}));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

const ALL: FormatId[] = ['heic', 'jpeg', 'png', 'webp', 'pdf', 'gif', 'bmp', 'tiff'];

const render = (navigation = stubNavigation()) =>
  renderScreen(<HomeScreen {...screenProps('Home', undefined, navigation)} />);

beforeEach(() => {
  useCapabilitiesStore.setState({
    decode: new Set(ALL),
    encode: new Set(ALL),
    pdfOperations: new Set(['compose', 'split', 'merge', 'rasterise', 'compress'] as never),
    isLoaded: true,
    error: null,
  });
  useHistoryStore.setState({ entries: [] });
});

describe('the grid', () => {
  it('draws a tile for every task the build can actually do', async () => {
    await render();

    const available = CONVERSION_TASKS.filter(isTaskAvailable);
    expect(available.length).toBeGreaterThan(0);

    for (const task of available) {
      expect(screen.getByTestId(`task-${task.id}`)).toBeOnTheScreen();
    }
  });

  it('labels each tile with the task title from the catalogue', async () => {
    await render();

    // Read through i18n rather than hardcoded, so a renamed key fails here rather than
    // silently rendering a raw key string to the user.
    expect(screen.getByText(t('tasks.heic-to-jpg.title'))).toBeOnTheScreen();
  });

  it('states the promise the whole app rests on', async () => {
    await render();

    expect(screen.getByText(t('home.promise'))).toBeOnTheScreen();
  });
});

describe('the header', () => {
  it('always offers settings, which is where appearance lives', async () => {
    const navigation = stubNavigation();
    await render(navigation);

    await fireEvent.press(screen.getByTestId('open-settings'));

    expect(navigation.navigate).toHaveBeenCalledWith('Settings');
  });

  it('hides history until there is history, rather than offering a dead end', async () => {
    await render();

    expect(screen.queryByTestId('open-history')).toBeNull();
  });

  it('offers history once something has been converted', async () => {
    const navigation = stubNavigation();
    useHistoryStore.setState({
      entries: [
        {
          id: 'e1',
          at: Date.UTC(2026, 0, 15),
          taskId: 'compress-image',
          targetFormat: 'jpeg',
          fileCount: 2,
          failedCount: 0,
          bytesBefore: 4_000_000,
          bytesAfter: 1_000_000,
          outputNames: ['a.jpg', 'b.jpg'],
        },
      ],
    });

    await render(navigation);
    await fireEvent.press(screen.getByTestId('open-history'));

    expect(navigation.navigate).toHaveBeenCalledWith('History');
  });
});

describe('a build that cannot do something', () => {
  beforeEach(() => {
    // A device whose decoder does not know HEIC. The tile has to stay: a task that
    // vanishes leaves the user looking for a feature the store listing promised.
    useCapabilitiesStore.setState({
      decode: new Set(ALL.filter((f) => f !== 'heic')),
      encode: new Set(ALL),
      isLoaded: true,
    });
  });

  it('still draws the tile, so the absence is explained rather than silent', async () => {
    await render();

    expect(screen.getByTestId('task-heic-to-jpg')).toBeOnTheScreen();
  });

  it('says why, in the place the subtitle would otherwise be', async () => {
    await render();

    expect(screen.getByText(t('home.unavailable.device'))).toBeOnTheScreen();
  });

  /**
   * The regression that writing this file found.
   *
   * A closed tile withholds `onPress`, and `Card` took that as licence to render a bare
   * `View` — dropping the label along with the role. The tile whose entire purpose is to
   * explain an absence was the one tile a screen reader could not read, and every
   * tappable tile beside it announced correctly, so nothing looked wrong.
   */
  it('remains readable by a screen reader even with nothing to tap', async () => {
    await render();

    const tile = screen.getByTestId('task-heic-to-jpg');
    expect(tile).toHaveProp('accessible', true);
    expect(tile.props.accessibilityLabel).toContain(t('home.unavailable.device'));
  });
});
