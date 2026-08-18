// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Regression guard for a bug that made the app unusable.
 *
 * The home screen used to disable every tile while any pick was in flight. A native
 * picker dismissed in a way its delegate never observed left the promise unresolved,
 * so the `finally` that clears the flag never ran — and the entire grid stayed dead
 * until the app was relaunched. There was no path back from inside the app.
 *
 * The fix has two halves. Swift now guarantees its continuation resumes exactly once
 * (covered by ConverterCoreTests, not here), and the screen only ever dims the tile
 * that was actually tapped. This asserts the second half.
 */

import { render, screen, fireEvent } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { HomeScreen } from '@/features/home/HomeScreen';
import { ThemeProvider } from '@/theme';

/** A pick that never settles — exactly the condition that used to brick the grid. */
const hangingPick = jest.fn(() => new Promise<never>(() => {}));

jest.mock('@/native', () => ({
  fileGateway: {
    pickPhotos: (...args: unknown[]) => hangingPick(...(args as [])),
  },
}));

// Phase 1 ships one available tile, which would make "the others stay live" vacuous.
// Treating them all as available is what puts the invariant under test.
jest.mock('@/features/home/tasks', () => {
  const actual = jest.requireActual('@/features/home/tasks');
  return { ...actual, isTaskAvailable: () => true };
});

const Stack = createNativeStackNavigator();

function renderHome() {
  return render(
    <ThemeProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Home" component={HomeScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </ThemeProvider>,
  );
}

describe('a picker that never settles', () => {
  beforeEach(() => hangingPick.mockClear());

  it('dims only the tapped tile, leaving the rest of the grid usable', () => {
    renderHome();

    const tapped = screen.getByTestId('task-heic-to-jpg');
    fireEvent.press(tapped);

    expect(hangingPick).toHaveBeenCalledTimes(1);

    // The one the user pressed stops being a button while its pick is outstanding.
    expect(screen.queryByTestId('task-heic-to-jpg')?.props.accessibilityRole).toBeUndefined();

    // Every other tile is still a live control. Before the fix, all of these went dead.
    for (const id of ['task-webp-to-jpg', 'task-compress-image', 'task-image-to-pdf']) {
      expect(screen.getByTestId(id).props.accessibilityRole).toBe('button');
    }
  });

  it('does not open a second picker while one is already outstanding', () => {
    renderHome();

    fireEvent.press(screen.getByTestId('task-heic-to-jpg'));
    fireEvent.press(screen.getByTestId('task-webp-to-jpg'));

    // Two pickers at once is a worse bug than a dim tile.
    expect(hangingPick).toHaveBeenCalledTimes(1);
  });
});
