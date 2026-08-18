// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import type { FormatId } from '@/engine/formats';
import type { DetectedFile } from '@/native/types';
import type { CapabilitiesState } from '@/store/capabilities';
import {
  CONVERSION_TASKS,
  isTaskAvailable,
  isTaskSupported,
  type ConversionTask,
} from '@/features/home/tasks';

/**
 * Which tasks make sense for a set of files someone handed us.
 *
 * The user did not choose a task — they chose files somewhere else and pointed them
 * here — so the app has to work out what it can offer. Getting this wrong in the
 * permissive direction is worse than in the strict one: offering "PDF to JPG" for three
 * photos produces a screen that can only fail.
 */

export type Applicability = {
  task: ConversionTask;
  /** How many of the received files this task can actually take. */
  matchCount: number;
};

/** True when the task can read this file's format. */
const accepts = (task: ConversionTask, file: DetectedFile): boolean =>
  file.format !== '' && task.sourceFormats.includes(file.format as FormatId);

/**
 * Ranked by how much of the selection each task can use, then by the order they appear
 * on the home screen — which is already ordered by how often people want them.
 */
export function applicableTasks(
  files: DetectedFile[],
  capabilities: Pick<CapabilitiesState, 'decode' | 'encode' | 'pdfOperations' | 'isLoaded'>,
): Applicability[] {
  if (files.length === 0) return [];

  return CONVERSION_TASKS.map((task, order) => ({ task, order }))
    .filter(({ task }) => isTaskAvailable(task) && isTaskSupported(task, capabilities))
    .map(({ task, order }) => ({
      task,
      order,
      matchCount: files.filter((file) => accepts(task, file)).length,
    }))
    // A task that can take none of them is not an option, and a task that needs two
    // documents cannot run on one however well the format matches.
    .filter(({ task, matchCount }) => matchCount > 0 && !(task.needsMultiple && files.length < 2))
    .sort((a, b) => b.matchCount - a.matchCount || a.order - b.order)
    .map(({ task, matchCount }) => ({ task, matchCount }));
}

/** The files a task would actually act on, in the order they arrived. */
export const filesFor = (task: ConversionTask, files: DetectedFile[]): DetectedFile[] =>
  files.filter((file) => accepts(task, file));
