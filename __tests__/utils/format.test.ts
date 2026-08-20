// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { formatBytes, formatDimensions, formatDuration, percentageSaved,
  describeSizeChange,
} from '@/utils/format';

describe('formatBytes', () => {
  // The unit name comes from `Intl` rather than from an English table, so the spacing
  // between number and unit is the locale's business too — English closes it up, German
  // does not. Every call here pins a locale for that reason.
  it('uses 1000-based units, as a file manager does', () => {
    expect(formatBytes(0, 'en-US')).toBe('0B');
    expect(formatBytes(999, 'en-US')).toBe('999B');
    expect(formatBytes(1000, 'en-US')).toBe('1.0kB');
    expect(formatBytes(51_487, 'en-US')).toBe('51kB');
    expect(formatBytes(95_937, 'en-US')).toBe('96kB');
  });

  it('keeps one decimal below ten of a unit so the width stays stable', () => {
    expect(formatBytes(1_500_000, 'en-US')).toBe('1.5MB');
    expect(formatBytes(48_200_000, 'en-US')).toBe('48MB');
  });

  it('does not run out of units on absurd sizes', () => {
    expect(formatBytes(5e12, 'en-US')).toBe('5.0TB');
    // Past terabytes it keeps counting in TB rather than inventing a unit.
    expect(formatBytes(5e15, 'en-US')).toBe('5,000TB');
  });

  it('returns a placeholder rather than NaN for nonsense input', () => {
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });

  it('follows the locale for grouping and decimal separators', () => {
    // A Hindi or Arabic user should not see Western formatting in the one place the
    // app shows off its work.
    expect(formatBytes(1_500_000, 'de-DE')).toBe('1,5 MB');
  });
});

describe('percentageSaved', () => {
  it('reports a saving', () => {
    expect(percentageSaved(48_200_000, 9_600_000)).toBe(80);
  });

  it('reports growth honestly, as a negative', () => {
    // The real case that exposed this: a smooth gradient encodes far smaller in HEVC
    // than in JPEG, so a correct HEIC to JPEG conversion grows the file. Reporting
    // "0% saved" here would look like a bug in the converter.
    expect(percentageSaved(51_487, 95_937)).toBe(-86);
  });

  it('is zero when nothing changed', () => {
    expect(percentageSaved(1000, 1000)).toBe(0);
  });

  it('does not divide by zero on an empty source', () => {
    expect(percentageSaved(0, 1000)).toBe(0);
  });
});

describe('formatDimensions', () => {
  it('uses a multiplication sign, not the letter x', () => {
    expect(formatDimensions(1600, 1200, 'en-US')).toBe('1,600 × 1,200');
  });
});

describe('formatDuration', () => {
  it('shows sub-second times with one decimal', () => {
    expect(formatDuration(100, 'en-US')).toBe('0.1s');
    expect(formatDuration(940, 'en-US')).toBe('0.9s');
  });

  it('drops the decimal once past a second', () => {
    expect(formatDuration(2100, 'en-US')).toBe('2s');
  });

  it('switches to minutes with a zero-padded seconds field', () => {
    expect(formatDuration(65_000, 'en-US')).toBe('1m 05s');
    expect(formatDuration(605_000, 'en-US')).toBe('10m 05s');
  });
});

/**
 * The label is a catalogue key rather than a word, so these no longer break when someone
 * rewords "Saved" — and they do break when the key stops existing, which is the failure
 * that reaches the screen as a raw `common.saved`.
 *
 * Every call pins a locale. The default is the app's active language, and a test that
 * reads global state passes or fails depending on which suite ran before it.
 */
describe('describing how the size changed', () => {
  it('says what was saved', () => {
    expect(describeSizeChange(1000, 400, 'en-US')).toEqual({
      labelKey: 'common.saved',
      value: '60%',
      grew: false,
    });
  });

  it('says when the file grew, which converting to PNG often does', () => {
    expect(describeSizeChange(400, 1000, 'en-US')).toEqual({
      labelKey: 'common.largerBy',
      value: '150%',
      grew: true,
    });
  });

  it('refuses to say "Larger by 0%", which is a contradiction', () => {
    // A batch that grew by a fraction of a percent rounds to zero, and the honest
    // answer is that nothing meaningful changed.
    expect(describeSizeChange(1000, 1001, 'en-US')).toEqual({
      labelKey: 'common.aboutTheSame',
      value: '',
      grew: false,
    });
  });

  it('says the same for an exact match', () => {
    expect(describeSizeChange(1000, 1000, 'en-US').labelKey).toBe('common.aboutTheSame');
  });

  it('does not divide by a before-size of zero', () => {
    expect(describeSizeChange(0, 500, 'en-US').labelKey).toBe('common.aboutTheSame');
  });

  it('writes the percentage the way the language writes it', () => {
    // German puts a space before the sign and English does not. Asserting the two differ
    // pins the value to `Intl` without pinning it to one ICU version's spelling — the
    // point being that a hand-built `${percent}%` could not tell them apart.
    expect(describeSizeChange(1000, 400, 'de-DE').value).not.toBe(
      describeSizeChange(1000, 400, 'en-US').value,
    );
  });
});

/**
 * Pins the rounding rather than the formatter.
 *
 * These pass on Node whether or not the value is pre-rounded, because Node's ICU honours
 * `maximumFractionDigits` with `style: 'unit'`. Hermes on iOS does not, and rendered
 * `4.433 MB` where one decimal was asked for. The rounding is what makes the two agree, so
 * it is asserted on the value that reaches the screen.
 */
describe('sizes and durations round before they are formatted', () => {
  it('keeps a megabyte to one decimal', () => {
    expect(formatBytes(4_433_000, 'en-US')).toBe('4.4MB');
    expect(formatBytes(1_013_000, 'en-US')).toBe('1.0MB');
  });

  it('keeps a sub-second duration to one decimal', () => {
    expect(formatDuration(311, 'en-US')).toBe('0.3s');
  });

  it('drops the decimal once a unit is into double figures', () => {
    expect(formatBytes(45_600_000, 'en-US')).toBe('46MB');
  });
});
