// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The two numbers a store will not let you reuse.
 *
 * `version` is the one people read. `buildNumber` and `versionCode` are the ones the stores
 * key uploads on, and both platforms reject a build whose number is not higher than the last
 * one accepted. There is no way to correct that after the fact: the number is spent whether
 * or not the build was ever released.
 *
 * Expo defaults both to 1 when they are absent, which is the failure mode worth guarding
 * against. The first submission works, so nothing looks wrong, and the second is rejected
 * at upload by a value nobody chose and nobody can find in the config. Requiring them to be
 * written down makes a bump an edit somebody makes on purpose.
 */

import config from '../../app.json';

const { expo } = config;

describe('the release numbers are chosen rather than defaulted', () => {
  it('states a marketing version in semver', () => {
    expect(expo.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('states an iOS build number explicitly', () => {
    // A string, because CFBundleVersion is one, and Expo passes it through unchanged.
    expect(typeof expo.ios.buildNumber).toBe('string');
    expect(expo.ios.buildNumber).toMatch(/^\d+$/);
  });

  it('states an Android version code explicitly', () => {
    // An integer, because Gradle's versionCode is one and a string silently becomes 0.
    expect(Number.isInteger(expo.android.versionCode)).toBe(true);
    expect(expo.android.versionCode).toBeGreaterThan(0);
  });

  /**
   * Kept in lockstep on purpose. They are separate numbers on separate stores and nothing
   * forces them to agree, but letting them drift means two things to remember at release
   * and two ways to get it wrong. One number, bumped once, serves both.
   */
  it('keeps the two platforms on the same number', () => {
    expect(Number(expo.ios.buildNumber)).toBe(expo.android.versionCode);
  });
});
