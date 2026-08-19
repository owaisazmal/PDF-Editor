// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { create } from 'zustand';

import type { FormatId } from '@/engine/formats';
import { KEYS, read, remove, write } from './storage';

/**
 * What you converted, and when.
 *
 * Deliberately a record of the work rather than of the files. Each entry holds counts,
 * sizes, the task and the output names — enough to answer "where did that go?" and "did
 * that actually save anything?", which are the two questions people come back with. It
 * holds no file contents, no thumbnails, and no path to anything outside the app's own
 * storage, so a history that leaks tells an attacker what formats someone converts.
 *
 * Capped rather than unbounded. A converter used daily would otherwise accumulate a list
 * nobody scrolls and a file nobody notices growing.
 */

/** Beyond this the oldest entries fall off. Roughly a year of ordinary use. */
export const HISTORY_LIMIT = 200;

export type HistoryEntry = {
  id: string;
  /** Milliseconds since the epoch, so it can be formatted in the user's locale. */
  at: number;
  /** The task, by id. Its title is read from the catalogue when the row is drawn. */
  taskId: string;
  /**
   * The English title, as written by builds before the catalogue covered this screen.
   *
   * Kept only so those rows still say something: a title captured at record time is
   * frozen in whatever language was running then, so a user who switches to Spanish
   * would otherwise carry English rows forever. Nothing writes it any more, and rows
   * whose `taskId` is still a known task ignore it.
   */
  taskTitle?: string;
  targetFormat: FormatId | 'pdf';
  fileCount: number;
  failedCount: number;
  bytesBefore: number;
  bytesAfter: number;
  /** Output display names, for recognising the batch. Capped; the count is authoritative. */
  outputNames: string[];
};

/** Names beyond this are dropped: the list is for recognition, not for reproduction. */
const NAMES_KEPT = 8;

export type HistoryState = {
  entries: HistoryEntry[];
  record: (entry: Omit<HistoryEntry, 'id' | 'at'>) => void;
  removeEntry: (id: string) => void;
  clear: () => void;
};

const isEntry = (value: unknown): value is HistoryEntry => {
  const entry = value as Partial<HistoryEntry> | null;
  return (
    typeof entry?.id === 'string' &&
    typeof entry.at === 'number' &&
    typeof entry.taskId === 'string' &&
    typeof entry.fileCount === 'number'
  );
};

/**
 * Anything unreadable is dropped rather than repaired. A history entry is not worth a
 * migration, and a half-understood one renders as a row that makes no sense.
 */
const parse = (raw: unknown): HistoryEntry[] | null =>
  Array.isArray(raw) ? raw.filter(isEntry) : null;

export const useHistoryStore = create<HistoryState>((set, get) => ({
  entries: read(KEYS.history, parse, []),

  record(entry) {
    // Nothing worth remembering about a batch that converted nothing.
    if (entry.fileCount === 0) return;

    const recorded: HistoryEntry = {
      ...entry,
      id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      at: Date.now(),
      outputNames: entry.outputNames.slice(0, NAMES_KEPT),
    };

    const entries = [recorded, ...get().entries].slice(0, HISTORY_LIMIT);
    set({ entries });
    write(KEYS.history, entries);
  },

  removeEntry(id) {
    const entries = get().entries.filter((entry) => entry.id !== id);
    set({ entries });
    write(KEYS.history, entries);
  },

  clear() {
    set({ entries: [] });
    remove(KEYS.history);
  },
}));

/** Total saved across the whole history, for the one line worth showing at the top. */
export function totalSaved(entries: HistoryEntry[]): { before: number; after: number } {
  return entries.reduce(
    (total, entry) => ({
      before: total.before + entry.bytesBefore,
      after: total.after + entry.bytesAfter,
    }),
    { before: 0, after: 0 },
  );
}
