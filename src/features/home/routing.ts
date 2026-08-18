// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import type { DetectedFile } from '@/native/types';
import { useBatchStore } from '@/store/batch';
import { useConversionStore } from '@/store/conversion';
import { usePdfStore } from '@/store/pdf';
import type { ConversionTask } from './tasks';

/**
 * Where a task goes once it has files.
 *
 * Extracted because there are now two ways to arrive with a selection — picking one, and
 * being handed one by another app — and they must land in exactly the same place. A
 * second copy of this would drift, and the drift would show up as a share that skips the
 * settings screen a picked file gets.
 */

/**
 * Only what routing needs.
 *
 * Structural rather than React Navigation's own prop type, because that type is
 * parameterised by the screen it came from — and this is called from two different
 * screens, which would otherwise mean two incompatible signatures for one function.
 */
export type TaskNavigation = {
  navigate: (
    screen: 'Convert' | 'Batch' | 'Options' | 'Pdf',
    params: { taskId: string },
  ) => void;
};

/** Why a task cannot be started with these files. Null when it can. */
export function blockedReason(task: ConversionTask, files: DetectedFile[]): string | null {
  if (files.length === 0) return 'Nothing was selected.';
  if (task.needsMultiple && files.length < 2) {
    // Said before anything starts: a merge of one document is not an error the engine
    // should have to report, and nothing has been lost yet.
    return 'Merging needs at least two PDFs. Pick another and try again.';
  }
  return null;
}

/**
 * Seeds the store the destination screen reads from, then navigates.
 *
 * Each screen submits its own work rather than being handed a result, so that it is
 * mounted and listening before the first event can arrive.
 */
export function routeToTask(
  navigation: TaskNavigation,
  task: ConversionTask,
  files: DetectedFile[],
): void {
  const first = files[0];
  if (!first) return;

  if (task.kind === 'pdf') {
    // Seeded here and inspected by the screen, so a password prompt appears over the
    // screen it belongs to rather than over whatever the user was looking at.
    usePdfStore.getState().reset();
    usePdfStore.setState({ sources: files, status: 'idle' });
    navigation.navigate('Pdf', { taskId: task.id });
    return;
  }

  if (files.length === 1) {
    useConversionStore.getState().setSource(first);
    // Tasks that exist to expose a setting go through it; everything else keeps the
    // fast path, which is what holds the three-tap promise.
    navigation.navigate(task.needsOptions ? 'Options' : 'Convert', { taskId: task.id });
    return;
  }

  useBatchStore.getState().reset();
  useBatchStore.setState({ sources: files, status: 'idle' });
  navigation.navigate(task.needsOptions ? 'Options' : 'Batch', { taskId: task.id });
}
