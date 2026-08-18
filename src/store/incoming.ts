// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { AppState, Linking, Platform } from 'react-native';
import { create } from 'zustand';

import { fileGateway, formatDetector } from '@/native';
import type { DetectedFile } from '@/native/types';

/**
 * Files that arrived from outside the app.
 *
 * Three doors lead here — a share sheet, an Open With, and later a drop — and they arrive
 * differently on each platform. Android delivers an `Intent`, which native parks in a
 * queue and hands over on request. iOS delivers a `file://` URL through the linking
 * system, which JavaScript already observes. Unifying them here rather than in each
 * screen is the point: everything downstream sees the same `DetectedFile[]` the pickers
 * produce and never learns where a file came from.
 */

/**
 * URLs iOS has already handed us.
 *
 * `getInitialURL` keeps returning the launching URL for the life of the process, so
 * without this every check would resurrect a file the user has already dealt with.
 * Module-level rather than in the store, because it must survive a reset.
 */
const consumed = new Set<string>();

const isFileUrl = (url: string): boolean => url.startsWith('file://');

async function detectOne(url: string): Promise<DetectedFile | null> {
  if (!isFileUrl(url) || consumed.has(url)) return null;
  consumed.add(url);
  try {
    return await formatDetector.detect(url);
  } catch {
    // A file that cannot be read is not worth an error screen when the user has not
    // asked for anything yet. It simply does not appear.
    return null;
  }
}

/** iOS: whatever launched or reached the app as a file URL. */
async function fromLinking(): Promise<DetectedFile[]> {
  if (Platform.OS !== 'ios') return [];
  const initial = await Linking.getInitialURL();
  if (!initial) return [];
  const detected = await detectOne(initial);
  return detected ? [detected] : [];
}

export type IncomingState = {
  files: DetectedFile[];
  /** True while a check is in flight, so the UI does not flash an empty state. */
  isChecking: boolean;

  collect: () => Promise<void>;
  add: (files: DetectedFile[]) => void;
  clear: () => void;
};

export const useIncomingStore = create<IncomingState>((set, get) => ({
  files: [],
  isChecking: false,

  /**
   * Asks both platforms what is waiting.
   *
   * Safe to call repeatedly: the native queue is drained rather than read, and the URLs
   * iOS repeats are remembered, so a second call after a reload finds nothing rather than
   * the same share twice.
   */
  async collect() {
    if (get().isChecking) return;
    set({ isChecking: true });
    try {
      const [pending, linked] = await Promise.all([
        fileGateway.takePendingFiles().catch(() => [] as DetectedFile[]),
        fromLinking().catch(() => [] as DetectedFile[]),
      ]);

      const arrived = [...pending, ...linked];
      if (arrived.length > 0) set((state) => ({ files: [...state.files, ...arrived] }));
    } finally {
      set({ isChecking: false });
    }
  },

  add(files) {
    if (files.length === 0) return;
    set((state) => ({ files: [...state.files, ...files] }));
  },

  clear() {
    set({ files: [] });
  },
}));

/**
 * Starts listening for files arriving at a running app.
 *
 * Returns an unsubscribe. All three hooks are installed unconditionally — the native
 * event never fires on iOS and the linking event never carries a file URL on Android, so
 * neither needs a platform check to be correct.
 *
 * The third is the one that makes this reliable. An event can be missed: a host activity
 * may consume the intent before the listener sees it, and a JavaScript bundle can reload
 * between the intent arriving and anything subscribing. Native holds the queue either
 * way, so asking again every time the app comes back to the foreground turns a missed
 * event from a share that vanished into a share that appears a moment later. Draining
 * rather than reading is what makes the extra ask free of duplicates.
 */
export function watchIncomingFiles(): () => void {
  const collect = () => {
    void useIncomingStore.getState().collect();
  };

  const nativeSubscription = fileGateway.onFilesReceived(collect);

  const linkingSubscription = Linking.addEventListener('url', ({ url }) => {
    void detectOne(url).then((detected) => {
      if (detected) useIncomingStore.getState().add([detected]);
    });
  });

  const appStateSubscription = AppState.addEventListener('change', (next) => {
    if (next === 'active') collect();
  });

  return () => {
    nativeSubscription();
    linkingSubscription.remove();
    appStateSubscription.remove();
  };
}
