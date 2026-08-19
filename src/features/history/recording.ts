// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useEffect, useRef } from 'react';

import { useHistoryStore, type HistoryEntry } from '@/store/history';
import type { ConversionResult, DetectedFile } from '@/native/types';
import type { ConversionTask } from '@/features/home/tasks';

/**
 * The shape stored: what was done, not what it was done to.
 *
 * The before-size comes from the sources rather than the results, because a result
 * describes the file that was written and carries no memory of the one it came from.
 */
export function summarise(
  task: ConversionTask,
  sources: DetectedFile[],
  results: ConversionResult[],
  /** A count rather than the failures themselves: the batch and single-file paths carry
   * different failure shapes, and history only ever shows how many. */
  failedCount: number,
): Omit<HistoryEntry, 'id' | 'at'> {
  return {
    taskId: task.id,
    taskTitle: task.title,
    targetFormat: task.targetFormat,
    fileCount: results.length,
    failedCount,
    bytesBefore: sources.reduce((total, source) => total + source.byteSize, 0),
    bytesAfter: results.reduce((total, result) => total + result.byteSize, 0),
    outputNames: results.map((result) => result.outputDisplayName),
  };
}

/**
 * Records a finished batch, exactly once.
 *
 * The guard is the whole reason this is a hook rather than a call. A screen re-renders
 * many times after a batch finishes — a save, a haptic, a navigation animation — and a
 * plain effect would write a row on each, turning one conversion into a dozen identical
 * entries.
 */
export function useRecordConversion(
  task: ConversionTask | undefined,
  finished: boolean,
  sources: DetectedFile[],
  results: ConversionResult[],
  failedCount: number,
): void {
  const record = useHistoryStore((state) => state.record);
  const recorded = useRef(false);

  useEffect(() => {
    if (!finished) {
      // Reset, so the same mounted screen can record a second run — a retry, or another
      // batch started without leaving.
      recorded.current = false;
      return;
    }
    if (recorded.current || !task || results.length === 0) return;
    recorded.current = true;

    record(summarise(task, sources, results, failedCount));
  }, [finished, task, sources, results, failedCount, record]);
}
