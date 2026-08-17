#!/usr/bin/env node
// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Makes Expo SDK 57 build on a Swift toolchain that predates SE-0481 ("weak let").
 *
 * `expo-modules-jsi` declares `weak let` properties. That syntax was accepted for a
 * Swift release later than the one in Xcode 26.1.1, where it fails with
 * "'weak' must be a mutable variable" in every language mode — it is not gated behind
 * an upcoming-feature flag, it simply is not implemented. The result is that a clean
 * checkout cannot build iOS at all on that Xcode.
 *
 * Rather than pin the project to a newer Xcode, this rewrites the affected
 * declarations to `nonisolated(unsafe) weak var`.
 *
 * Both halves of that rewrite are needed. `weak var` restores syntax the compiler
 * understands, but every one of these properties lives in a `Sendable` class, and a
 * mutable stored property is exactly what `Sendable` forbids — which is the problem
 * `weak let` was introduced to solve. `nonisolated(unsafe)` re-states the guarantee
 * the `let` used to carry: the property is never reassigned after `init`, so the
 * mutability is nominal. The result is semantically what upstream wrote.
 *
 * Two properties make this safe to leave in place:
 *
 *   - It probes the actual toolchain first. On an Xcode whose Swift implements
 *     SE-0481 it does nothing at all, so it disappears on its own rather than
 *     becoming a patch someone has to remember to remove.
 *   - It is idempotent, and it only ever touches `weak let` on a declaration line.
 *
 * Runs from `postinstall`. Silent no-op on Linux and Windows, and in CI where the
 * relevant job runs on a current Xcode image.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'node_modules', 'expo-modules-jsi', 'apple');

if (process.platform !== 'darwin') process.exit(0);

const exists = async (path) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

if (!(await exists(TARGET))) process.exit(0);

/** Compiles a two-line probe to find out what this toolchain actually accepts. */
async function toolchainSupportsWeakLet() {
  const scratch = await mkdtemp(join(tmpdir(), 'weaklet-probe-'));
  const file = join(scratch, 'probe.swift');
  try {
    await writeFile(
      file,
      'final class T {}\nfinal class H { weak let t: T?\n  init(_ v: T) { t = v } }\n',
      'utf8',
    );
    await run('xcrun', ['swiftc', '-typecheck', file]);
    return true;
  } catch {
    return false;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (await toolchainSupportsWeakLet()) {
  // Nothing to do — and nothing left behind.
  process.exit(0);
}

/**
 * Only a declaration at the start of a line, never a comment or a string. Matches
 * `weak var` as well as `weak let` so a re-run after a partial patch converges, and
 * skips anything already carrying `nonisolated`.
 */
const DECLARATION = /^(\s*(?:public |internal |private |fileprivate )?)weak (?:let|var)\b/gm;

async function* swiftFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) yield* swiftFiles(full);
    else if (entry.name.endsWith('.swift')) yield full;
  }
}

/**
 * `abs` under C++ interop.
 *
 * ExpoModulesJSI builds with `-cxx-interoperability-mode=default`, which imports C++'s
 * `abs` overloads into the global namespace alongside Swift's generic `abs`. On this
 * toolchain that makes the call ambiguous. Qualifying it as `Swift.abs` picks the
 * intended overload and changes nothing else.
 */
const UNQUALIFIED_ABS = /(?<![.\w])abs\(/g;

const RULES = [
  {
    name: 'weak let',
    match: DECLARATION,
    apply: (source) => source.replace(DECLARATION, '$1nonisolated(unsafe) weak var'),
  },
  {
    name: 'ambiguous abs under C++ interop',
    match: UNQUALIFIED_ABS,
    apply: (source) => source.replace(UNQUALIFIED_ABS, 'Swift.abs('),
  },
];

let patched = 0;
const applied = new Set();

for await (const file of swiftFiles(TARGET)) {
  let source = await readFile(file, 'utf8');
  const before = source;

  for (const rule of RULES) {
    rule.match.lastIndex = 0;
    if (!rule.match.test(source)) continue;
    rule.match.lastIndex = 0;
    source = rule.apply(source);
    applied.add(rule.name);
  }

  if (source === before) continue;
  await writeFile(file, source, 'utf8');
  patched += 1;
}

if (patched > 0) {
  const swiftVersion = await run('xcrun', ['swift', '--version'])
    .then(({ stdout }) => stdout.split('\n').find((line) => line.includes('Swift version'))?.trim())
    .catch(() => 'unknown');

  console.log(
    `expo-modules-jsi: applied toolchain compatibility fixes to ${patched} file(s).\n` +
      `  Fixes: ${[...applied].join('; ')}.\n` +
      `  Reason: Expo SDK 57 targets a newer Swift than this one (${swiftVersion}).\n` +
      '  This is applied automatically and disappears once Xcode ships a Swift that\n' +
      '  supports the syntax. See scripts/patch-swift-weak-let.mjs.',
  );
}
