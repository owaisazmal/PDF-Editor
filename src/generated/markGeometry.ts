// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0
//
// GENERATED FILE — DO NOT EDIT.
// Source: scripts/brand/mark.mjs   Regenerate: npm run icons:gen

/**
 * Where the mark's parts hinge, as fractions of its square box.
 *
 * A flap folds about the kite's outer edge it was creased along; the tail swings from the
 * kite's bottom point. `degrees` is the clockwise rotation that lays the vertical axis
 * along the hinge, so rotating a flap about its hinge is
 * `rotate(degrees) · rotateY(fold) · rotate(-degrees)` with the pivot as the origin.
 */
export const MARK_GEOMETRY = {
  top: [0.6671, 0],
  right: [0.8314, 0.3226],
  bottom: [0.4344, 0.716],
  left: [0.3445, 0.1644],
  flapLeft: { pivot: [0.3895, 0.4402], degrees: -9.2553 },
  flapRight: { pivot: [0.6329, 0.5193], degrees: 45.2553 },
  /** The kite's own height as a fraction of the box. */
  kiteHeight: 0.7529,
} as const;
