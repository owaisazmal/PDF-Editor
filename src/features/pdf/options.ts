// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import type { Chip } from '@/components';
import {
  PDF_FIT_MODES,
  PDF_N_UP,
  PDF_ORIENTATIONS,
  PDF_PAGE_SIZES,
  type PdfFitMode,
  type PdfOrientation,
  type PdfPageSize,
} from '@/engine/pdfClient';

/**
 * The PDF option vocabulary, in the words a person would use.
 *
 * Kept apart from the screen for the same reason the resize presets are: these are
 * product decisions about what to offer and what to call it, and they are easier to
 * argue about when they are a list rather than buried in JSX.
 */

export const PAGE_SIZE_CHIPS: readonly Chip<PdfPageSize>[] = [
  // First, because it is the right answer more often than A4 is — a screenshot on A4 is
  // a screenshot with a large white border.
  { value: 'fit', label: 'Fit image', detail: 'Each page takes the shape of its image' },
  { value: 'a4', label: 'A4', detail: 'The standard almost everywhere' },
  { value: 'letter', label: 'Letter', detail: 'The standard in the US and Canada' },
  { value: 'legal', label: 'Legal', detail: 'Longer than Letter' },
  { value: 'a5', label: 'A5', detail: 'Half of A4' },
  { value: 'a3', label: 'A3', detail: 'Twice A4' },
  { value: 'tabloid', label: 'Tabloid', detail: 'Twice Letter' },
];

export const ORIENTATION_SEGMENTS: readonly { value: PdfOrientation; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
];

export const FIT_MODE_SEGMENTS: readonly { value: PdfFitMode; label: string }[] = [
  { value: 'fit', label: 'Fit' },
  { value: 'fill', label: 'Fill' },
  { value: 'stretch', label: 'Stretch' },
];

export const FIT_MODE_HINTS: Record<PdfFitMode, string> = {
  fit: 'The whole image, with space around it where the shapes differ',
  fill: 'Fills the page and crops what does not fit',
  stretch: 'Fills the page by distorting the image',
};

export const N_UP_CHIPS: readonly Chip<(typeof PDF_N_UP)[number]>[] = [
  { value: 1, label: '1 per page' },
  { value: 2, label: '2 up' },
  { value: 4, label: '4 up' },
  { value: 6, label: '6 up' },
  { value: 9, label: '9 up' },
];

export const RENDER_FORMAT_SEGMENTS: readonly { value: 'jpeg' | 'png'; label: string }[] = [
  { value: 'jpeg', label: 'JPG' },
  { value: 'png', label: 'PNG' },
];

/**
 * Named densities rather than a bare number, because "300" means nothing until you know
 * what it is for. The values are the ones that actually matter: screen, print, and the
 * one archivists ask for.
 */
export const DPI_CHIPS: readonly Chip<number>[] = [
  { value: 72, label: 'Screen', detail: '72 dots per inch' },
  { value: 150, label: 'Good', detail: '150 dots per inch' },
  { value: 300, label: 'Print', detail: '300 dots per inch' },
  { value: 600, label: 'Archive', detail: '600 dots per inch, large files' },
];

export const SPLIT_MODE_SEGMENTS: readonly { value: 'ranges' | 'every'; label: string }[] = [
  { value: 'ranges', label: 'Page ranges' },
  { value: 'every', label: 'Every N pages' },
];

/** Sanity: the option lists and the schemas must offer the same things. */
export const OPTION_LISTS_MATCH_SCHEMA =
  PAGE_SIZE_CHIPS.length === PDF_PAGE_SIZES.length &&
  ORIENTATION_SEGMENTS.length === PDF_ORIENTATIONS.length &&
  FIT_MODE_SEGMENTS.length === PDF_FIT_MODES.length &&
  N_UP_CHIPS.length === PDF_N_UP.length;
