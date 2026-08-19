// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * An in-memory MMKV.
 *
 * The real one is a native module, so importing it under Jest throws before a single
 * assertion runs. Mocking it is not only a workaround: the storage layer's rules — schema
 * versioning, dropping what it cannot read, clearing everything — are worth testing, and
 * they are pure logic sitting on top of a key-value store that does not care whether it
 * is native.
 *
 * Deliberately behaves like the real thing where it matters: `getString` returns
 * `undefined` rather than null for a missing key, and `remove` reports whether anything
 * went.
 */

type Value = string | number | boolean | ArrayBuffer;

class InMemoryMMKV {
  private readonly entries = new Map<string, Value>();

  set(key: string, value: Value): void {
    this.entries.set(key, value);
  }

  getString(key: string): string | undefined {
    const value = this.entries.get(key);
    return typeof value === 'string' ? value : undefined;
  }

  getNumber(key: string): number | undefined {
    const value = this.entries.get(key);
    return typeof value === 'number' ? value : undefined;
  }

  getBoolean(key: string): boolean | undefined {
    const value = this.entries.get(key);
    return typeof value === 'boolean' ? value : undefined;
  }

  getBuffer(key: string): ArrayBuffer | undefined {
    const value = this.entries.get(key);
    return value instanceof ArrayBuffer ? value : undefined;
  }

  contains(key: string): boolean {
    return this.entries.has(key);
  }

  remove(key: string): boolean {
    return this.entries.delete(key);
  }

  getAllKeys(): string[] {
    return [...this.entries.keys()];
  }

  clearAll(): void {
    this.entries.clear();
  }
}

export const createMMKV = () => new InMemoryMMKV();
export const existsMMKV = () => true;
export const deleteMMKV = () => undefined;
