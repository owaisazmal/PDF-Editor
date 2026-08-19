// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { formatBytes, formatDimensions, formatDuration, percentageSaved,
  describeSizeChange,
} from '@/utils/format';

describe('formatBytes', () => {
  it('uses 1000-based units, as a file manager does', () => {
    expect(formatBytes(0, 'en-US')).toBe('0 B');
    expect(formatBytes(999, 'en-US')).toBe('999 B');
    expect(formatBytes(1000, 'en-US')).toBe('1.0 KB');
    expect(formatBytes(51_487, 'en-US')).toBe('51 KB');
    expect(formatBytes(95_937, 'en-US')).toBe('96 KB');
  });

  it('keeps one decimal below ten of a unit so the width stays stable', () => {
    expect(formatBytes(1_500_000, 'en-US')).toBe('1.5 MB');
    expect(formatBytes(48_200_000, 'en-US')).toBe('48 MB');
  });

  it('does not run out of units on absurd sizes', () => {
    expect(formatBytes(5e12, 'en-US')).toBe('5.0 TB');
    // Past terabytes it keeps counting in TB rather than inventing a unit.
    expect(formatBytes(5e15, 'en-US')).toBe('5,000 TB');
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

describe('describing how the size changed', () => {
  it('says what was saved', () => {
    expect(describeSizeChange(1000, 400)).toEqual({ label: 'Saved', value: '60%', grew: false });
  });

  it('says when the file grew, which converting to PNG often does', () => {
    expect(describeSizeChange(400, 1000)).toEqual({ label: 'Larger by', value: '150%', grew: true });
  });

  it('refuses to say "Larger by 0%", which is a contradiction', () => {
    // A batch that grew by a fraction of a percent rounds to zero, and the honest
    // answer is that nothing meaningful changed.
    expect(describeSizeChange(1000, 1001)).toEqual({
      label: 'About the same size',
      value: '',
      grew: false,
    });
  });

  it('says the same for an exact match', () => {
    expect(describeSizeChange(1000, 1000).label).toBe('About the same size');
  });

  it('does not divide by a before-size of zero', () => {
    expect(describeSizeChange(0, 500).label).toBe('About the same size');
  });
});
