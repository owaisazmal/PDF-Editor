// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Batch renaming exists three times — here, in Swift and in Kotlin — because the rename
 * happens where the files are written. These tests pin what the two native copies have
 * to match, and they exist because a rename that surprises someone is discovered across
 * four hundred files at once.
 */

import en from '@/i18n/locales/en.json';
import { NAME_TOKENS, appendToken, collides, expandName, previewNames } from '@/engine/naming';
import { RESIZE_PRESETS } from '@/engine/presets';

/** Fixed, because a test that changes meaning at midnight is not a test. */
const today = new Date(2026, 7, 18);

const inputs = (overrides: Partial<Parameters<typeof expandName>[1]> = {}) => ({
  sourceName: 'IMG_4021.HEIC',
  index: 0,
  format: 'jpeg',
  today,
  ...overrides,
});

describe('expanding a name pattern', () => {
  it('keeps the source name when no pattern is given', () => {
    expect(expandName('', inputs())).toBe('IMG_4021');
    expect(expandName('   ', inputs())).toBe('IMG_4021');
  });

  it('drops the original extension rather than carrying it into the new name', () => {
    // Otherwise a converted file is called IMG_4021.HEIC.jpg.
    expect(expandName('{name}', inputs())).toBe('IMG_4021');
  });

  it('keeps a name that has no extension at all', () => {
    expect(expandName('{name}', inputs({ sourceName: 'scan' }))).toBe('scan');
  });

  it('keeps every dot but the last in a name that has several', () => {
    expect(expandName('{name}', inputs({ sourceName: 'v1.2.final.png' }))).toBe('v1.2.final');
  });

  it('numbers from one, padded, because filenames are read by people', () => {
    expect(expandName('{index}', inputs({ index: 0 }))).toBe('001');
    expect(expandName('{index}', inputs({ index: 41 }))).toBe('042');
  });

  it('writes a date that sorts as text', () => {
    expect(expandName('{date}', inputs())).toBe('2026-08-18');
  });

  it('substitutes the format being written', () => {
    expect(expandName('{format}', inputs())).toBe('jpeg');
  });

  it('replaces every occurrence, not just the first', () => {
    expect(expandName('{index}-{index}', inputs({ index: 2 }))).toBe('003-003');
  });

  it('combines tokens with the literal text around them', () => {
    expect(expandName('Invoice {index} ({date})', inputs({ index: 6 }))).toBe(
      'Invoice 007 (2026-08-18)',
    );
  });

  it('leaves an unknown token alone rather than guessing', () => {
    // Silently deleting it would produce a name the user did not ask for and cannot
    // explain; leaving it visible makes the mistake obvious in the preview.
    expect(expandName('{nope}-{index}', inputs())).toBe('{nope}-001');
  });
});

describe('warning about a pattern that collides', () => {
  it('says nothing about an empty pattern', () => {
    expect(collides('')).toBe(false);
  });

  it('accepts anything that varies per file', () => {
    expect(collides('{name}')).toBe(false);
    expect(collides('scan-{index}')).toBe(false);
  });

  it('flags a pattern that would name every file the same thing', () => {
    // The collision resolver would produce "report (1)", "report (2)" — dutiful, and
    // not what someone who typed a fixed name was picturing.
    expect(collides('report')).toBe(true);
    expect(collides('{date}')).toBe(true);
    expect(collides('{format}-{date}')).toBe(true);
  });
});

describe('previewing what a batch will be called', () => {
  it('shows the first few names with the new extension', () => {
    expect(previewNames('{name}', ['a.heic', 'b.heic', 'c.heic', 'd.heic'], 'jpeg', today)).toEqual([
      'a.jpeg',
      'b.jpeg',
      'c.jpeg',
    ]);
  });

  it('numbers across the batch rather than restarting per file', () => {
    expect(previewNames('shot-{index}', ['a.png', 'b.png'], 'webp', today)).toEqual([
      'shot-001.webp',
      'shot-002.webp',
    ]);
  });

  it('handles a batch shorter than the preview limit', () => {
    expect(previewNames('{name}', ['only.jpg'], 'png', today)).toEqual(['only.png']);
  });
});

describe('the tokens the chip row offers', () => {
  it('offers only tokens that expandName actually substitutes', () => {
    // The literal and the catalogue key are two fields now, and nothing but this stops
    // them drifting apart: a chip that inserts `{filename}` puts the token itself into
    // every name in the batch, and the preview says so far too quietly.
    for (const { token } of NAME_TOKENS) {
      expect(expandName(token, inputs())).not.toBe(token);
    }
  });

  it('gives each token a label and a detail in the catalogue', () => {
    const tokens: Record<string, unknown> = en.options.tokens;
    for (const { id } of NAME_TOKENS) {
      const entry = tokens[id] as { label?: unknown; detail?: unknown } | undefined;
      expect(typeof entry?.label).toBe('string');
      expect(typeof entry?.detail).toBe('string');
    }
  });
});

/**
 * The other list on the options screen whose ids are catalogue keys, tested here rather
 * than in a file of its own because the rot is the same one: `id` is the only join
 * between a preset and its words, and nothing in TypeScript checks it.
 */
describe('the resize presets', () => {
  it('is a list of ids and the settings they apply', () => {
    for (const preset of RESIZE_PRESETS) {
      expect(typeof preset.id).toBe('string');
      expect(typeof preset.apply).toBe('function');
    }
  });

  it('gives each preset a label and a detail in the catalogue', () => {
    const presets: Record<string, unknown> = en.options.resizePresets;
    for (const { id } of RESIZE_PRESETS) {
      const entry = presets[id] as { label?: unknown; detail?: unknown } | undefined;
      expect(typeof entry?.label).toBe('string');
      expect(typeof entry?.detail).toBe('string');
    }
  });

  it('carries no words for a preset that does not exist', () => {
    const ids = new Set(RESIZE_PRESETS.map((preset) => preset.id));
    expect(Object.keys(en.options.resizePresets).filter((key) => !ids.has(key))).toEqual([]);
  });
});

describe('inserting a token from the chip row', () => {
  it('starts a pattern with the token alone', () => {
    expect(appendToken('', '{name}')).toBe('{name}');
  });

  it('separates two tokens tapped in a row', () => {
    // Without this, {date}{index} renders as "2026-08-18001" — one run-on number.
    expect(appendToken('{date}', '{index}')).toBe('{date}-{index}');
  });

  it('leaves typed text alone, which already ends where the user meant it to', () => {
    expect(appendToken('Invoice ', '{index}')).toBe('Invoice {index}');
    expect(appendToken('scan-', '{index}')).toBe('scan-{index}');
  });
});
