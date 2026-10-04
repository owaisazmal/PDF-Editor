// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { estimateRemainingMs } from '@/utils/useProgressClock';

describe('estimateRemainingMs', () => {
  it('projects the rate seen so far over what is left', () => {
    // A quarter done in ten seconds leaves thirty.
    expect(estimateRemainingMs(10_000, 0.25)).toBe(30_000);
  });

  it('says nothing before there is a rate to go on', () => {
    expect(estimateRemainingMs(500, 0.5)).toBeNull();
    expect(estimateRemainingMs(10_000, 0.01)).toBeNull();
    expect(estimateRemainingMs(10_000, 0)).toBeNull();
  });

  it('says nothing once the work is done', () => {
    expect(estimateRemainingMs(10_000, 1)).toBeNull();
  });

  /** A retry starts with the bar part-full; counting that as progress promised too little. */
  it('measures the rate from where the bar stood when the clock started', () => {
    expect(estimateRemainingMs(10_000, 0.75, 0.5)).toBe(10_000);
    expect(estimateRemainingMs(10_000, 0.5, 0.5)).toBeNull();
  });
});
