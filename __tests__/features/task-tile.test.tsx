// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The format pair on a tile. Format names are the same in every language, but two of the
 * badges are words, and those were shown in English whatever the device was set to.
 */

import { act, screen } from '@testing-library/react-native';

import { TaskTile } from '@/components';
import { i18n } from '@/i18n';
import { renderScreen } from '../support/renderScreen';

const tile = (from: string, to: string) => (
  <TaskTile title="Title" subtitle="Subtitle" from={from} to={to} onPress={jest.fn()} />
);

afterEach(async () => {
  await act(() => i18n.changeLanguage('en'));
});

it('translates the word badges', async () => {
  await act(() => i18n.changeLanguage('es'));

  await renderScreen(tile('ANY', 'ANY'));
  expect(screen.getAllByText(i18n.getFixedT('es')('tasks.badge.any'))).toHaveLength(2);
  expect(screen.queryByText('ANY')).toBeNull();
});

it('translates IMG, which is a word too', async () => {
  await act(() => i18n.changeLanguage('ja'));

  await renderScreen(tile('IMG', 'PDF'));
  expect(screen.getByText(i18n.getFixedT('ja')('tasks.badge.img'))).toBeOnTheScreen();
});

it('leaves format names alone', async () => {
  await act(() => i18n.changeLanguage('de'));

  await renderScreen(tile('HEIC', 'JPG'));
  expect(screen.getByText('HEIC')).toBeOnTheScreen();
  expect(screen.getByText('JPG')).toBeOnTheScreen();
});
