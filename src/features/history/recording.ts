// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useEffect, useRef } from 'react';

import { useHistoryStore, type HistoryEntry } from '@/store/history';
import type { ConversionResult, DetectedFile } from '@/native/types';
import type { ConversionTask } from '@/features/home/tasks';

/**
 * What history needs from an output. Narrower than `ConversionResult` so a PDF operation,
 * whose documents, parts and page images are different shapes, can be recorded too.
 * `sourceIndex`, when present, is the output's position in what the user picked.
 */
export type RecordableResult = Pick<ConversionResult, 'outputUri' | 'outputDisplayName' | 'byteSize'> & {
  sourceIndex?: number;
};

/**
 * The shape stored: what was done, not what it was done to.
 *
 * The before-size comes from the sources rather than the results, because a result
 * describes the file that was written and carries no memory of the one it came from.
 */
export function summarise(
  task: ConversionTask,
  sources: DetectedFile[],
  results: RecordableResult[],
  /** A count rather than the failures themselves: the batch and single-file paths carry
   * different failure shapes, and history only ever shows how many. */
  failedCount: number,
): Omit<HistoryEntry, 'id' | 'at'> {
  return {
    // The id, not the title. A title written here would be a translated string frozen
    // into storage — a Spanish user who converted something last week would find an
    // English row waiting for them.
    taskId: task.id,
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
 *
 * A retry finishes the same batch a second time with its earlier results still in the
 * list, so only outputs not yet recorded count. Recording the whole list again wrote a
 * second "10 files" row for a retry that converted nothing.
 */
export function useRecordConversion(
  task: ConversionTask | undefined,
  finished: boolean,
  sources: DetectedFile[],
  results: RecordableResult[],
  failedCount: number,
  /**
   * False for work that is not about size: merging, splitting, rendering pages. A page
   * image is meant to be bigger than the PDF it came from, and "+1,373%" beside it, or
   * that growth folded into the all-time "Saved" figure, would misreport what happened.
   */
  comparesSize = true,
): void {
  const record = useHistoryStore((state) => state.record);
  const recorded = useRef(false);
  const recordedOutputs = useRef(new Set<string>());

  useEffect(() => {
    if (!finished) {
      // Reset, so the same mounted screen can record a second run — a retry, or another
      // batch started without leaving.
      recorded.current = false;
      return;
    }
    if (recorded.current || !task) return;
    recorded.current = true;

    const fresh = results.filter((result) => !recordedOutputs.current.has(result.outputUri));
    if (fresh.length === 0) return;
    fresh.forEach((result) => recordedOutputs.current.add(result.outputUri));

    // The sources those outputs came from, so the before-size is theirs alone. A result
    // without a position (the single-file path) belongs to the one source there is.
    const freshSources = fresh.every(
      (result) => result.sourceIndex !== undefined && sources[result.sourceIndex] !== undefined,
    )
      ? fresh.map((result) => sources[result.sourceIndex!]!)
      : sources;

    const entry = summarise(task, freshSources, fresh, failedCount);
    record(comparesSize ? entry : { ...entry, bytesBefore: 0, bytesAfter: 0 });
  }, [finished, task, sources, results, failedCount, comparesSize, record]);
}
