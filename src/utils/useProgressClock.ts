// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useEffect, useRef, useState } from 'react';

/** Too little done, or too little time, and the rate is noise rather than an estimate. */
const MIN_PROGRESS = 0.03;
const MIN_ELAPSED_MS = 1000;

/**
 * Time left at the rate seen so far, or null while there is nothing to go on.
 * `startFraction` is where the bar stood when the clock started, as on a retry.
 */
export function estimateRemainingMs(
  elapsedMs: number,
  fraction: number,
  startFraction = 0,
): number | null {
  const gained = fraction - startFraction;
  if (!(gained >= MIN_PROGRESS) || fraction >= 1 || elapsedMs < MIN_ELAPSED_MS) return null;
  return (elapsedMs * (1 - fraction)) / gained;
}

export type ProgressClock = {
  elapsedMs: number;
  /** Null for work that reports no progress, and until an estimate is possible. */
  remainingMs: number | null;
};

type Start = { at: number; fraction: number; now: number };

/** Ticks once a second while `active`, and estimates the time left from `fraction`. */
export function useProgressClock(active: boolean, fraction?: number): ProgressClock {
  const [start, setStart] = useState<Start | null>(null);
  const latest = useRef(fraction);
  useEffect(() => {
    latest.current = fraction;
  }, [fraction]);

  useEffect(() => {
    if (!active) return;
    const at = Date.now();
    setStart({ at, fraction: latest.current ?? 0, now: at });
    const timer = setInterval(() => {
      setStart((current) => (current ? { ...current, now: Date.now() } : current));
    }, 1000);
    return () => {
      clearInterval(timer);
      setStart(null);
    };
  }, [active]);

  if (!start) return { elapsedMs: 0, remainingMs: null };
  const elapsedMs = start.now - start.at;
  return {
    elapsedMs,
    remainingMs:
      fraction === undefined ? null : estimateRemainingMs(elapsedMs, fraction, start.fraction),
  };
}
