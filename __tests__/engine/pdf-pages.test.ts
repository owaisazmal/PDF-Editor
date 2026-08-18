// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Page ranges are the one piece of PDF syntax the user types by hand, and the same
 * parser exists three times — here, in Swift and in Kotlin. These tests are what pin the
 * behaviour the two native copies have to match.
 *
 * The failure worth preventing runs through most of them: a range that means nothing
 * must select nothing. Treating an unparseable range as "everything" is how a request
 * for three pages becomes a 400-page export.
 */

import {
  describePageSelection,
  expandPageRanges,
  groupEveryNPages,
} from '@/engine/pdfPages';

describe('expanding a page range', () => {
  it('treats an empty expression as the whole document', () => {
    expect(expandPageRanges('', 4)).toEqual([0, 1, 2, 3]);
    expect(expandPageRanges('   ', 3)).toEqual([0, 1, 2]);
  });

  it('reads page numbers as one-based and returns indices', () => {
    // The user types the number printed on the page; native counts from zero.
    expect(expandPageRanges('1', 5)).toEqual([0]);
    expect(expandPageRanges('5', 5)).toEqual([4]);
  });

  it('expands an inclusive range', () => {
    expect(expandPageRanges('2-4', 10)).toEqual([1, 2, 3]);
  });

  it('reads an open end as "to the end of the document"', () => {
    expect(expandPageRanges('9-', 12)).toEqual([8, 9, 10, 11]);
  });

  it('reads an open start as "from the beginning"', () => {
    expect(expandPageRanges('-3', 12)).toEqual([0, 1, 2]);
  });

  it('keeps the order the user wrote', () => {
    // Reordering here would silently undo a deliberate choice — someone extracting
    // pages in a particular sequence means that sequence.
    expect(expandPageRanges('3,1', 5)).toEqual([2, 0]);
  });

  it('collapses a page named twice', () => {
    expect(expandPageRanges('1-3,2', 5)).toEqual([0, 1, 2]);
  });

  it('reads a reversed range as the range that was meant', () => {
    expect(expandPageRanges('7-3', 10)).toEqual([2, 3, 4, 5, 6]);
  });

  it('clamps past the end rather than inventing pages', () => {
    expect(expandPageRanges('8-20', 10)).toEqual([7, 8, 9]);
  });

  it('selects nothing when the range is entirely past the end', () => {
    expect(expandPageRanges('50-60', 10)).toEqual([]);
  });

  it('selects nothing for an unparseable expression', () => {
    // The whole point: `4OO` with a letter O must not export four hundred pages.
    expect(expandPageRanges('4OO', 400)).toEqual([]);
    expect(expandPageRanges('abc', 10)).toEqual([]);
  });

  it('keeps the parts it understands and drops the ones it does not', () => {
    expect(expandPageRanges('2, oops, 5', 10)).toEqual([1, 4]);
  });

  it('tolerates the spacing people actually type', () => {
    expect(expandPageRanges(' 1 - 2 , 4 ', 10)).toEqual([0, 1, 3]);
  });

  it('returns nothing for an empty document whatever the range says', () => {
    expect(expandPageRanges('1-5', 0)).toEqual([]);
  });
});

describe('describing a selection', () => {
  it('says all when the range covers the document', () => {
    expect(describePageSelection('', 12)).toBe('All 12 pages');
    expect(describePageSelection('1-12', 12)).toBe('All 12 pages');
  });

  it('counts rather than echoing the range back', () => {
    expect(describePageSelection('2-4', 12)).toBe('3 of 12 pages');
  });

  it('says so plainly when a range matches nothing', () => {
    expect(describePageSelection('99', 12)).toBe('That range does not match any pages');
  });
});

describe('grouping every N pages', () => {
  it('splits into equal groups', () => {
    expect(groupEveryNPages(6, 2)).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it('leaves a short final group rather than padding it', () => {
    expect(groupEveryNPages(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
  });

  it('treats a nonsensical group size as one page each', () => {
    expect(groupEveryNPages(3, 0)).toEqual([[0], [1], [2]]);
  });
});
