// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { fileGateway } from '@/native';

/**
 * Deletes picked copies and unsaved output once no screen can reach them. Stores register
 * what they hold, so a file handed from one store to another is never deleted under it.
 */

type Holder = () => readonly string[];

const holders: Holder[] = [];

export function holdFiles(holder: Holder): void {
  holders.push(holder);
}

/** Never throws: a file left behind is cleared at the next launch anyway. */
export function discardFiles(uris: readonly string[]): void {
  if (uris.length === 0) return;
  const held = new Set(holders.flatMap((holder) => holder()));
  const unused = [...new Set(uris)].filter((uri) => uri.length > 0 && !held.has(uri));
  if (unused.length === 0) return;
  void Promise.resolve()
    .then(() => fileGateway.discardFiles(unused))
    .catch(() => {});
}
