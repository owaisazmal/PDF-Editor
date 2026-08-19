// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

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
 * The PDF option vocabulary.
 *
 * Kept apart from the screen for the same reason the resize presets are: these are
 * product decisions about what to offer and in what order, and they are easier to argue
 * about when they are a list rather than buried in JSX.
 *
 * They hold no words. A module evaluated once at import time cannot call `t`, and the
 * screen has to map these to chips anyway — so each entry is an identity and the screen
 * looks the words up under `pdf.pageSizes.*`, `pdf.dpi.*` and friends.
 */

/**
 * Page sizes, in the order offered.
 *
 * `fit` is first because it is the right answer more often than A4 is — a screenshot on
 * A4 is a screenshot with a large white border.
 */
export const PAGE_SIZE_VALUES: readonly PdfPageSize[] = [
  'fit',
  'a4',
  'letter',
  'legal',
  'a5',
  'a3',
  'tabloid',
];

export const ORIENTATION_VALUES: readonly PdfOrientation[] = ['auto', 'portrait', 'landscape'];

export const FIT_MODE_VALUES: readonly PdfFitMode[] = ['fit', 'fill', 'stretch'];

export const N_UP_VALUES: readonly (typeof PDF_N_UP)[number][] = [...PDF_N_UP];

export const RENDER_FORMAT_VALUES: readonly ('jpeg' | 'png')[] = ['jpeg', 'png'];

export const SPLIT_MODE_VALUES: readonly ('ranges' | 'every')[] = ['ranges', 'every'];

/**
 * Named densities rather than a bare number, because "300" means nothing until you know
 * what it is for. The values are the ones that actually matter: screen, print, and the
 * one archivists ask for. The id names the row in the catalogue; the number is the
 * number, interpolated so it formats like every other number in the app.
 */
export const DPI_VALUES: readonly { id: 'screen' | 'good' | 'print' | 'archive'; dpi: number }[] = [
  { id: 'screen', dpi: 72 },
  { id: 'good', dpi: 150 },
  { id: 'print', dpi: 300 },
  { id: 'archive', dpi: 600 },
];

/** Sanity: the option lists and the schemas must offer the same things. */
export const OPTION_LISTS_MATCH_SCHEMA =
  PAGE_SIZE_VALUES.length === PDF_PAGE_SIZES.length &&
  ORIENTATION_VALUES.length === PDF_ORIENTATIONS.length &&
  FIT_MODE_VALUES.length === PDF_FIT_MODES.length &&
  N_UP_VALUES.length === PDF_N_UP.length;
