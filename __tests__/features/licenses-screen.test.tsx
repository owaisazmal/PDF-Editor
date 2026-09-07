// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The screen that discharges a licence obligation.
 *
 * Apache 2.0 section 4(d) asks for the NOTICE to be conveyed with the distribution, and
 * the Open Font Licence asks the same of the font's terms. A LICENSES.md in a Git
 * repository does not reach someone who installed the app from a store. For a while both
 * NOTICE and LICENSES.md pointed that person at this screen while it did not exist, which
 * is the failure these assertions exist to prevent recurring.
 *
 * So the test is blunt on purpose: the screen must render, and it must render entries.
 * An empty licences screen satisfies a smoke test and conveys nothing.
 */

import { screen } from '@testing-library/react-native';

import { LicensesScreen } from '@/features/settings/LicensesScreen';
import inventory from '@/generated/licenses.json';
import { renderScreen, screenProps, t } from '../support/renderScreen';

jest.mock('@/native', () => require('../support/nativeMock').createNativeMock());

const render = () => renderScreen(<LicensesScreen {...screenProps('Licenses', undefined)} />);

describe('the inventory it draws from', () => {
  it('is not empty, or the screen below proves nothing', () => {
    expect(inventory.packages.length).toBeGreaterThan(0);
    expect(inventory.native.length).toBeGreaterThan(0);
  });

  it('names a licence for every single entry', () => {
    const all = [...inventory.packages, ...inventory.native];

    // A blank licence field is worse than a missing entry: it looks conveyed and is not.
    for (const item of all) {
      expect(item.license.trim()).not.toBe('');
      expect(item.name.trim()).not.toBe('');
    }
  });

  it('carries no copyleft licence the project forbids', () => {
    const forbidden = /\b(GPL-[23]|AGPL|LGPL|SSPL|CC-BY-NC)\b/i;
    const offenders = [...inventory.packages, ...inventory.native]
      .filter((item) => forbidden.test(item.license))
      .map((item) => `${item.name} (${item.license})`);

    // The gate script checks this too. Repeated here because this is the list that
    // actually ships inside the binary, and a divergence between the two is the bug.
    expect(offenders).toEqual([]);
  });
});

describe('the screen', () => {
  it('renders, which for a long time it did not', async () => {
    await render();

    expect(screen.getByText(t('licenses.title'))).toBeOnTheScreen();
  });

  it("states the app's own notice alongside the third-party ones", async () => {
    await render();

    expect(screen.getByText(t('licenses.appNotice'))).toBeOnTheScreen();
  });

  it('counts every entry it is conveying', async () => {
    await render();

    const total = inventory.packages.length + inventory.native.length;
    expect(screen.getByText(t('licenses.subtitle', { count: total }))).toBeOnTheScreen();
  });

  it('shows actual entries rather than empty sections', async () => {
    await render();

    // The first package is guaranteed to be within the initial render window. Asserted
    // to exist first, so an empty inventory fails here rather than throwing on a lookup.
    const first = inventory.packages[0];
    expect(first).toBeDefined();
    const escaped = first!.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(screen.getByLabelText(new RegExp(escaped))).toBeOnTheScreen();
  });
});
