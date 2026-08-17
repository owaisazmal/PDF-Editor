// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Global test setup.
 *
 * The most important thing here is the network guard: this app must never make a
 * network request, and a unit test that quietly starts one would hide exactly the
 * regression we care most about. Any `fetch`, `XMLHttpRequest` or `WebSocket` in a
 * unit test fails that test loudly. Integration-level proof lives in the proxy job
 * in CI — see docs/ARCHITECTURE.md §6.
 */

const networkForbidden = (api: string) => () => {
  throw new Error(
    `${api} was called during a unit test. This app performs no network I/O — ` +
      'every conversion is on-device. If a new dependency introduced this, it does ' +
      'not belong in the tree.',
  );
};

beforeEach(() => {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: networkForbidden('fetch()'),
  });
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    writable: true,
    value: networkForbidden('XMLHttpRequest'),
  });
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    writable: true,
    value: networkForbidden('WebSocket'),
  });
});
