// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

export type RootStackParamList = {
  Home: undefined;
  Convert: { taskId: string };
  Batch: { taskId: string };
  Options: { taskId: string };
  /** Every PDF task shares one screen; the id decides which options it shows. */
  Pdf: { taskId: string };
  /** Files handed over by another app, before a task has been chosen. */
  Incoming: undefined;
  /** What has been converted on this device. */
  History: undefined;
  /** The app's own settings — appearance, language, and who made it. */
  Settings: undefined;
};

declare global {
  namespace ReactNavigation {
    // React Navigation's global type registration is declaration merging, so an
    // interface with no members of its own is exactly the intended shape here.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
