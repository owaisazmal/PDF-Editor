// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The harness the screen tests share.
 *
 * Screens are rendered through the same three providers the real app mounts, because a
 * screen that renders under a stubbed theme proves nothing about the one users see: half
 * the layout in this app comes from theme tokens, and a stub would quietly supply values
 * the real palette does not have.
 *
 * `initI18n('en')` rather than a mock of `useTranslation`. A mocked `t` that echoes its
 * key turns every assertion into a test of the key name, which stays green when the key
 * is missing from the catalogue — precisely the failure that matters in an app shipping
 * nine languages. Rendering against the real catalogue means a deleted or renamed string
 * fails the test that reads it.
 */

import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { render, type RenderResult } from '@testing-library/react-native';

import { i18n, initI18n } from '@/i18n';
import { ThemeProvider } from '@/theme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '@/navigation/types';

initI18n('en');

/**
 * Fixed metrics, so a test never depends on the simulated device.
 * `SafeAreaProvider` otherwise measures asynchronously and renders nothing on first pass.
 */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/**
 * Async because `render` is.
 *
 * Testing Library 14 returns a promise from `render` — React 19 renders concurrently, and
 * the queries are only attached once that settles. Calling it without awaiting yields a
 * promise whose `getByTestId` is `undefined`, and every query then fails with "`render`
 * function has not been called", which points at the wrong thing entirely.
 *
 * The composite rows in this app (`StatRow`, `FileRow`) mark their halves
 * `accessibilityElementsHidden` and expose one combined `accessibilityLabel`, so a screen
 * reader hears "Before: 2.4MB" rather than two unrelated readings. Text queries skip
 * accessibility-hidden nodes, so those rows are found with `getByLabelText`, never
 * `getByText`.
 *
 * `fireEvent` is async for the same reason, and has a nastier failure: an un-awaited press
 * still runs its handler, so anything asserted against a mock passes. Only assertions
 * about what was re-rendered fail, which reads as a broken component rather than a missing
 * `await`. Await every press.
 */
export async function renderScreen(element: ReactElement): Promise<RenderResult> {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>{element}</ThemeProvider>
      </I18nextProvider>
    </SafeAreaProvider>,
  );
}

/** The navigation surface a screen actually touches, and nothing else. */
export type StubNavigation = {
  navigate: jest.Mock;
  goBack: jest.Mock;
  replace: jest.Mock;
  setOptions: jest.Mock;
  addListener: jest.Mock;
};

export function stubNavigation(): StubNavigation {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    replace: jest.fn(),
    setOptions: jest.fn(),
    // Returns an unsubscribe, because screens call this inside an effect and React
    // invokes whatever comes back on unmount.
    addListener: jest.fn(() => jest.fn()),
  };
}

/**
 * Screen props shaped like React Navigation's, cast once here.
 *
 * The real type carries a dozen members no screen in this app calls. Casting in one
 * place keeps the casts out of the tests themselves, where they would read as though
 * the test were working around a type error rather than declaring a fixture.
 */
export function screenProps<Name extends keyof RootStackParamList>(
  name: Name,
  params: RootStackParamList[Name],
  navigation: StubNavigation = stubNavigation(),
) {
  return {
    navigation,
    route: { key: `${name}-test`, name, params },
  } as unknown as NativeStackScreenProps<RootStackParamList, Name>;
}

/** i18n is initialised once per worker; tests read strings through this. */
export const t = i18n.getFixedT('en');
