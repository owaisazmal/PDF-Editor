// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { create } from 'zustand';

import { formatDetector, rasterCodec } from '@/native';
import type { ConversionResult, DetectedFile } from '@/native/types';
import type { ConversionOptionsInput } from '@/engine/options';
import { ConversionErrorCode } from '@/native/types';
import { discardFiles, holdFiles } from './files';

export type ConversionPhase = 'idle' | 'picking' | 'ready' | 'converting' | 'done' | 'error';

export type ConversionFailure = {
  code: string;
  /** Developer-facing. The UI resolves a localised string from `code`. */
  message: string;
};

type ConversionState = {
  phase: ConversionPhase;
  source: DetectedFile | null;
  result: ConversionResult | null;
  failure: ConversionFailure | null;

  setPicking: () => void;
  setSource: (source: DetectedFile) => void;
  convert: (options: ConversionOptionsInput, outputUri: string) => Promise<void>;
  fail: (failure: ConversionFailure) => void;
  reset: () => void;
};

/**
 * Phase 1's single-file flow.
 *
 * This state is deliberately thin: from Phase 2 the native job queue owns batch
 * progress and this store becomes a mirror of it, replaced wholesale on every
 * foreground transition. Building richer bookkeeping here would only have to be
 * torn out — native has to be authoritative because it keeps running while the
 * JavaScript runtime is suspended.
 */
const filesOf = (state: Pick<ConversionState, 'source' | 'result'>): string[] => [
  ...(state.source ? [state.source.uri] : []),
  ...(state.result ? [state.result.outputUri] : []),
];

/** Bumped whenever the file or its run changes, so a stale result knows it is stale. */
let currentRun = 0;

export const useConversionStore = create<ConversionState>((set, get) => ({
  phase: 'idle',
  source: null,
  result: null,
  failure: null,

  setPicking: () => set({ phase: 'picking', failure: null }),

  setSource: (source) => {
    currentRun++;
    const previous = filesOf(get());
    set({ phase: 'ready', source, result: null, failure: null });
    discardFiles(previous);
  },

  fail: (failure) => set({ phase: 'error', failure }),

  reset: () => {
    currentRun++;
    const previous = filesOf(get());
    set({ phase: 'idle', source: null, result: null, failure: null });
    discardFiles(previous);
  },

  convert: async (options, outputUri) => {
    const { source } = useConversionStore.getState();
    if (!source) {
      set({
        phase: 'error',
        failure: { code: ConversionErrorCode.UNKNOWN, message: 'No file selected.' },
      });
      return;
    }

    const run = ++currentRun;
    set({ phase: 'converting', failure: null });
    try {
      const result = await rasterCodec.convert(source.uri, outputUri, options);
      // The user moved on while it ran; nothing can reach this output now.
      if (run !== currentRun) {
        discardFiles([result.outputUri]);
        return;
      }
      set({ phase: 'done', result });
    } catch (error) {
      if (run !== currentRun) return;
      set({
        phase: 'error',
        failure: {
          code: extractCode(error),
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  },
}));

holdFiles(() => filesOf(useConversionStore.getState()));

/**
 * Native rejections carry a stable `code` so the UI can show a translated message.
 * Anything without one is a bug on our side, not a user-facing condition, so it
 * falls back to the generic code rather than leaking an English string to the user.
 */
function extractCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return ConversionErrorCode.UNKNOWN;
}

/** Re-exported so screens do not need to reach into the native layer for a detection. */
export const detectFile = formatDetector.detect;
