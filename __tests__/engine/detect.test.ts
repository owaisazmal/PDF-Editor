// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { detectFromBytes, describeDetection } from '@/engine/detect';
import { ALL_FORMAT_IDS, FORMATS, type FormatId } from '@/engine/formats';

/* ------------------------------------------------------------------ builders ---- */

const bytes = (...values: (number | string)[]): Uint8Array => {
  const flat: number[] = [];
  for (const value of values) {
    if (typeof value === 'string') {
      for (const char of value) flat.push(char.charCodeAt(0));
    } else {
      flat.push(value);
    }
  }
  return Uint8Array.from(flat);
};

/** Pads to at least `length` so short synthetic headers survive prefix reads. */
const pad = (data: Uint8Array, length = 64): Uint8Array => {
  if (data.length >= length) return data;
  const out = new Uint8Array(length);
  out.set(data);
  return out;
};

const isoBmff = (brand: string) => pad(bytes(0, 0, 0, 0x18, 'ftyp', brand));

/**
 * Builds a little-endian TIFF with a real IFD0, so the RAW disambiguation is
 * exercised against genuine structure rather than a stubbed parser.
 */
function tiffLE(entries: { tag: number; ascii?: string }[]): Uint8Array {
  const HEADER = 8;
  const count = entries.length;
  const ifdSize = 2 + count * 12 + 4;
  const heapStart = HEADER + ifdSize;

  const heap: number[] = [];
  const out = new Uint8Array(heapStart + 256);
  const view = new DataView(out.buffer);

  out.set(bytes(0x49, 0x49, 0x2a, 0x00), 0);
  view.setUint32(4, HEADER, true); // IFD0 immediately follows the header
  view.setUint16(HEADER, count, true);

  entries.forEach((entry, index) => {
    const at = HEADER + 2 + index * 12;
    view.setUint16(at, entry.tag, true);

    if (entry.ascii === undefined) {
      view.setUint16(at + 2, 3, true); // SHORT
      view.setUint32(at + 4, 1, true);
      view.setUint32(at + 8, 1, true);
      return;
    }

    const value = `${entry.ascii}\0`;
    view.setUint16(at + 2, 2, true); // ASCII
    view.setUint32(at + 4, value.length, true);

    if (value.length <= 4) {
      for (let i = 0; i < value.length; i += 1) out[at + 8 + i] = value.charCodeAt(i);
    } else {
      const offset = heapStart + heap.length;
      view.setUint32(at + 8, offset, true);
      for (const char of value) heap.push(char.charCodeAt(0));
    }
  });

  out.set(Uint8Array.from(heap), heapStart);
  return out;
}

const TAG_MAKE = 0x010f;
const TAG_DNG_VERSION = 0xc612;

/* ------------------------------------------------------------------- fixtures --- */

const SAMPLES: Record<string, { data: Uint8Array; expect: FormatId }> = {
  jpeg: { data: pad(bytes(0xff, 0xd8, 0xff, 0xe0)), expect: 'jpeg' },
  png: { data: pad(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), expect: 'png' },
  'gif87a': { data: pad(bytes('GIF87a')), expect: 'gif' },
  'gif89a': { data: pad(bytes('GIF89a')), expect: 'gif' },
  bmp: { data: pad(bytes('BM')), expect: 'bmp' },
  webp: { data: pad(bytes('RIFF', 0, 0, 0, 0, 'WEBP', 'VP8 ')), expect: 'webp' },
  ico: { data: pad(bytes(0x00, 0x00, 0x01, 0x00, 0x01, 0x00)), expect: 'ico' },
  raf: { data: pad(bytes('FUJIFILMCCD-RAW')), expect: 'raf' },
  orf: { data: pad(bytes(0x49, 0x49, 0x52, 0x4f)), expect: 'orf' },
  pdf: { data: pad(bytes('%PDF-1.7')), expect: 'pdf' },
  heic: { data: isoBmff('heic'), expect: 'heic' },
  heix: { data: isoBmff('heix'), expect: 'heic' },
  heif: { data: isoBmff('mif1'), expect: 'heif' },
  avif: { data: isoBmff('avif'), expect: 'avif' },
  cr3: { data: isoBmff('crx '), expect: 'cr3' },
  cr2: { data: pad(bytes(0x49, 0x49, 0x2a, 0x00, 0x10, 0, 0, 0, 'CR', 2, 0)), expect: 'cr2' },
};

/* ---------------------------------------------------------------------- tests --- */

describe('signature detection', () => {
  for (const [name, { data, expect: expected }] of Object.entries(SAMPLES)) {
    it(`identifies ${name} as ${expected}`, () => {
      const result = detectFromBytes(data);
      expect(result.format).toBe(expected);
      expect(result.confidence).not.toBe('none');
    });
  }
});

describe('the TIFF family, which all share one header', () => {
  it('reads a plain TIFF as TIFF', () => {
    const result = detectFromBytes(tiffLE([{ tag: 0x0100 }]));
    expect(result.format).toBe('tiff');
    expect(result.confidence).toBe('deep');
  });

  it('separates DNG by its DNGVersion tag', () => {
    const result = detectFromBytes(tiffLE([{ tag: TAG_DNG_VERSION }]));
    expect(result.format).toBe('dng');
    expect(result.reason).toMatch(/DNGVersion/);
  });

  it('separates NEF by its EXIF Make', () => {
    const result = detectFromBytes(tiffLE([{ tag: TAG_MAKE, ascii: 'NIKON CORPORATION' }]));
    expect(result.format).toBe('nef');
  });

  it('separates ARW by its EXIF Make', () => {
    const result = detectFromBytes(tiffLE([{ tag: TAG_MAKE, ascii: 'SONY' }]));
    expect(result.format).toBe('arw');
  });

  it('prefers the DNG tag over the camera Make, since a Nikon DNG is still a DNG', () => {
    const result = detectFromBytes(
      tiffLE([{ tag: TAG_MAKE, ascii: 'NIKON CORPORATION' }, { tag: TAG_DNG_VERSION }]),
    );
    expect(result.format).toBe('dng');
  });

  it('falls back to TIFF when IFD0 is unreadable rather than guessing a RAW', () => {
    // Valid TIFF header, IFD0 offset pointing past the end of the data.
    const broken = pad(bytes(0x49, 0x49, 0x2a, 0x00, 0xff, 0xff, 0x00, 0x00));
    const result = detectFromBytes(broken);
    expect(result.format).toBe('tiff');
  });
});

describe('the extension is a claim, not a fact', () => {
  it('believes the bytes when a HEIC is named .png', () => {
    const result = detectFromBytes(SAMPLES.heic!.data, 'holiday.png');
    expect(result.format).toBe('heic');
    expect(result.claimedFormat).toBe('png');
    expect(result.extensionMismatch).toBe(true);
    expect(describeDetection(result)).toBe('HEIC (named as PNG)');
  });

  it('reports no mismatch when the name is honest', () => {
    const result = detectFromBytes(SAMPLES.heic!.data, 'holiday.heic');
    expect(result.extensionMismatch).toBe(false);
    expect(describeDetection(result)).toBe('HEIC');
  });

  it('reports no mismatch when the name says nothing useful', () => {
    const result = detectFromBytes(SAMPLES.jpeg!.data, 'IMG_0001');
    expect(result.claimedFormat).toBeNull();
    expect(result.extensionMismatch).toBe(false);
  });

  it('accepts any of a format’s alternate extensions', () => {
    expect(detectFromBytes(SAMPLES.jpeg!.data, 'a.jpeg').extensionMismatch).toBe(false);
    expect(detectFromBytes(SAMPLES.jpeg!.data, 'a.JPG').extensionMismatch).toBe(false);
    expect(detectFromBytes(SAMPLES.jpeg!.data, 'a.jfif').extensionMismatch).toBe(false);
  });
});

describe('files that should fail cleanly rather than crash the batch', () => {
  it('rejects a zero-byte file with a readable message', () => {
    const result = detectFromBytes(new Uint8Array(0), 'empty.jpg');
    expect(result.format).toBeNull();
    expect(result.reason).toMatch(/empty/i);
  });

  it('rejects random bytes', () => {
    const noise = Uint8Array.from({ length: 128 }, (_, i) => (i * 37 + 11) % 251);
    expect(detectFromBytes(noise).format).toBeNull();
  });

  it('rejects a file truncated mid-signature', () => {
    expect(detectFromBytes(Uint8Array.from([0xff, 0xd8])).format).toBeNull();
  });

  it('never throws, whatever it is handed', () => {
    const nasty = [
      new Uint8Array(0),
      Uint8Array.from([0]),
      Uint8Array.from([0x49, 0x49, 0x2a, 0x00]),
      Uint8Array.from(new Array(10).fill(0xff)),
      bytes('RIFF'),
      bytes('<svg'),
    ];
    for (const data of nasty) {
      expect(() => detectFromBytes(data, 'x.bin')).not.toThrow();
    }
  });
});

describe('formats with no fixed signature', () => {
  it('finds a PDF whose header sits behind leading junk', () => {
    const junk = bytes('\n\n   garbage before the header\n', '%PDF-1.4');
    const result = detectFromBytes(junk);
    expect(result.format).toBe('pdf');
    expect(result.reason).toMatch(/offset \d+/);
  });

  it('recognises SVG with an XML declaration', () => {
    const svg = bytes('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(detectFromBytes(svg).format).toBe('svg');
  });

  it('recognises a bare SVG element', () => {
    expect(detectFromBytes(bytes('<svg viewBox="0 0 1 1"/>')).format).toBe('svg');
  });

  it('does not mistake arbitrary XML for SVG', () => {
    expect(detectFromBytes(bytes('<?xml version="1.0"?><rss></rss>')).format).toBeNull();
  });

  it('does not scan binary data as text', () => {
    // "<svg" appearing after a NUL byte is data inside a binary file, not markup.
    const binary = bytes(0x00, 0x01, 0x02, '<svg ');
    expect(detectFromBytes(binary).format).toBeNull();
  });
});

describe('the format table itself', () => {
  it('gives every format a unique canonical extension', () => {
    const canonical = ALL_FORMAT_IDS.map((id) => FORMATS[id].extensions[0]);
    expect(new Set(canonical).size).toBe(canonical.length);
  });

  it('gives every format a UTI and at least one MIME type', () => {
    for (const id of ALL_FORMAT_IDS) {
      expect(FORMATS[id].uti).toBeTruthy();
      expect(FORMATS[id].mimeTypes.length).toBeGreaterThan(0);
    }
  });

  it('declares extensions in lowercase without dots', () => {
    for (const id of ALL_FORMAT_IDS) {
      for (const ext of FORMATS[id].extensions) {
        expect(ext).toBe(ext.toLowerCase());
        expect(ext.startsWith('.')).toBe(false);
      }
    }
  });

  it('marks every RAW format import-only, since none can be written', () => {
    for (const id of ALL_FORMAT_IDS) {
      if (FORMATS[id].kind === 'raw') expect(FORMATS[id].importOnly).toBe(true);
    }
  });
});
