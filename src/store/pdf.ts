// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { create } from 'zustand';

import {
  pdfClient,
  type PdfDocumentResult,
  type PdfInfo,
  type PdfPageImage,
  type PdfPart,
} from '@/engine/pdfClient';
import { errorKeyFor, type ErrorKey } from '@/features/convert/errors';
import type { DetectedFile } from '@/native/types';
import { discardFiles, holdFiles } from './files';

/**
 * One PDF operation, from the files picked to the files produced.
 *
 * Unlike the batch queue this is not a mirror of native state — PDF work is a single
 * call that either returns or throws, so the store owns the whole lifecycle. What it
 * does share with the batch store is the rule that native owns the filesystem: the store
 * holds URIs it was handed, never paths it constructed.
 *
 * The unlock session is the one piece of state with a lifetime beyond the screen. It is
 * released explicitly on reset, because leaving a decrypted document alive after the
 * user has moved on is exactly the kind of thing this app should not do.
 */

export type PdfStatus = 'idle' | 'inspecting' | 'locked' | 'ready' | 'running' | 'done' | 'failed';

export type PdfState = {
  sources: DetectedFile[];
  /** Only meaningful for single-document tasks; merge inspects nothing up front. */
  info: PdfInfo | null;
  sessionHandle: string;
  status: PdfStatus;
  /** A catalogue key. The screen turns it into a sentence. */
  errorKey: ErrorKey | null;
  /** Set when a password was tried and rejected, so the field can say so. */
  passwordFailed: boolean;

  /** Whichever shape the finished operation produced. */
  documents: PdfDocumentResult[];
  images: PdfPageImage[];
  parts: PdfPart[];
  elapsedMs: number;
  /** Pages (or parts) finished so far while running. Null until native reports any. */
  progress: { done: number; total: number } | null;

  begin: (sources: DetectedFile[]) => Promise<void>;
  /** Moves one document within the merge order. Out-of-range indices are ignored. */
  moveSource: (from: number, to: number) => void;
  unlock: (password: string) => Promise<void>;
  run: (work: () => Promise<Partial<PdfState>>) => Promise<void>;
  reset: () => void;
};

/** Everything a new operation starts from. A function, so no two runs share an array. */
const empty = (): Pick<
  PdfState,
  | 'info'
  | 'sessionHandle'
  | 'errorKey'
  | 'passwordFailed'
  | 'documents'
  | 'images'
  | 'parts'
  | 'elapsedMs'
  | 'progress'
> => ({
  info: null,
  sessionHandle: '',
  errorKey: null,
  passwordFailed: false,
  documents: [],
  images: [],
  parts: [],
  elapsedMs: 0,
  progress: null,
});

const outputsOf = (state: Pick<PdfState, 'documents' | 'images' | 'parts'>): string[] =>
  [...state.documents, ...state.images, ...state.parts].map((output) => output.outputUri);

/** Bumped by every run and reset, so a run the user walked away from knows it. */
let currentRun = 0;

/** The selection `begin` last inspected, kept across a reorder, which needs no new look. */
let inspected: DetectedFile[] | null = null;

/** True for a selection the screen has not inspected yet. */
export const isNewSelection = (sources: DetectedFile[]): boolean =>
  sources.length > 0 && sources !== inspected;

export const usePdfStore = create<PdfState>((set, get) => ({
  sources: [],
  status: 'idle',
  ...empty(),

  /**
   * Inspects the first document so the UI knows the page count before asking for a
   * range, and finds out whether a password is needed before asking for anything else.
   *
   * Merging is the exception: it takes many documents and needs nothing from any of them
   * up front, so it lands straight on `ready`.
   */
  /**
   * Reordering is the merge order, and the merge order is just this array: the engine
   * joins documents in the order it receives them. No native call is involved, which is
   * why the home screen was able to advertise "combine and reorder" for some time while
   * offering no way to do the second half.
   */
  moveSource(from, to) {
    const sources = [...usePdfStore.getState().sources];
    if (from < 0 || to < 0 || from >= sources.length || to >= sources.length) return;
    const [moved] = sources.splice(from, 1);
    if (!moved) return;
    sources.splice(to, 0, moved);
    if (inspected === usePdfStore.getState().sources) inspected = sources;
    set({ sources });
  },

  async begin(sources) {
    inspected = sources;
    set({ sources, status: 'inspecting', ...empty() });

    const first = sources[0];
    if (!first) {
      set({ status: 'failed', errorKey: 'errors.unknown' });
      return;
    }
    // An image-to-PDF task has no PDF to inspect yet — the document is the output.
    if (first.format !== 'pdf') {
      set({ status: 'ready' });
      return;
    }

    const run = currentRun;
    try {
      const info = await pdfClient.inspect(first.uri);
      if (run !== currentRun) return;
      set({ info, status: info.needsPassword ? 'locked' : 'ready' });
    } catch (error) {
      if (run !== currentRun) return;
      set({ status: 'failed', errorKey: errorKeyFor(error) });
    }
  },

  /**
   * Verifies a password and re-inspects.
   *
   * The password is passed straight through and never stored: what comes back is a
   * handle, and that is the only thing this store holds.
   */
  async unlock(password) {
    const source = get().sources[0];
    if (!source) return;

    set({ status: 'inspecting', passwordFailed: false, errorKey: null });
    try {
      const sessionHandle = await pdfClient.unlock(source.uri, password);
      if (get().sources[0] !== source) {
        pdfClient.closeSession(sessionHandle);
        return;
      }
      const info = await pdfClient.inspect(source.uri);
      if (get().sources[0] !== source) return;
      set({ sessionHandle, info, status: 'ready' });
    } catch (error) {
      if (get().sources[0] !== source) return;
      // A wrong password is not a failure of the operation, it is a fact about the
      // attempt — the screen stays on the prompt rather than falling into an error state.
      set({ status: 'locked', passwordFailed: true, errorKey: errorKeyFor(error) });
    }
  },

  /**
   * Runs one operation and files whatever it produced.
   *
   * Shared by all five tasks because the difference between them is entirely in the
   * call, not in the lifecycle: pick, run, show, save.
   */
  async run(work) {
    const run = ++currentRun;
    // A new run replaces the last one's files, which are no longer offered for saving.
    const previous = outputsOf(get());
    set({ status: 'running', errorKey: null, progress: null, documents: [], images: [], parts: [] });
    discardFiles(previous);
    const unsubscribe = pdfClient.onProgress((done, total) => {
      if (run === currentRun && get().status === 'running') set({ progress: { done, total } });
    });
    try {
      const produced = await work();
      if (run !== currentRun) {
        discardFiles(outputsOf({ documents: [], images: [], parts: [], ...produced }));
        return;
      }
      set({ ...produced, status: 'done' });
    } catch (error) {
      if (run === currentRun) set({ status: 'failed', errorKey: errorKeyFor(error) });
    } finally {
      unsubscribe();
    }
  },

  reset() {
    currentRun++;
    inspected = null;
    const state = get();
    // Released rather than left to a timeout: an unlocked document should not outlive
    // the screen the user unlocked it on.
    if (state.sessionHandle) pdfClient.closeSession(state.sessionHandle);
    set({ sources: [], status: 'idle', ...empty() });
    discardFiles([...state.sources.map((source) => source.uri), ...outputsOf(state)]);
  },
}));

holdFiles(() => {
  const state = usePdfStore.getState();
  return [...state.sources.map((source) => source.uri), ...outputsOf(state)];
});



/** True while the screen should show a spinner rather than controls. */
export const isPdfBusy = (status: PdfStatus): boolean =>
  status === 'inspecting' || status === 'running';
