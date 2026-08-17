// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Conversion settings: their schema, their defaults, and the reasoning behind the
 * defaults that are not obvious.
 *
 * Validation runs on the JavaScript side of the TurboModule boundary because codegen
 * cannot express a structure this deep — see the note in `NativeRasterCodec.ts`. That
 * makes this file the actual contract, so it is strict on purpose: an out-of-range
 * quality or an unknown target format fails here with a readable message rather than
 * reaching Swift and producing something surprising.
 */

import { z } from 'zod';

import { imageDefaults } from '@/theme/tokens';
import { ALL_FORMAT_IDS, FORMATS, type FormatId } from './formats';

const formatId = z.enum(ALL_FORMAT_IDS as [FormatId, ...FormatId[]]);

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Background fill must be an opaque #RRGGBB colour.');

export const resizeModes = ['none', 'percent', 'maxDimension', 'exact'] as const;
export type ResizeMode = (typeof resizeModes)[number];

export const metadataModes = ['stripAll', 'keepAll', 'keepExceptGps'] as const;
export type MetadataMode = (typeof metadataModes)[number];

export const resizeSchema = z
  .object({
    mode: z.enum(resizeModes).default('none'),
    percent: z.number().min(1).max(1000).default(100),
    maxWidth: z.number().int().min(0).default(0),
    maxHeight: z.number().int().min(0).default(0),
    exactWidth: z.number().int().min(0).default(0),
    exactHeight: z.number().int().min(0).default(0),
    allowUpscale: z.boolean().default(false),
  })
  .refine(
    (r) => r.mode !== 'maxDimension' || r.maxWidth > 0 || r.maxHeight > 0,
    'Resizing by maximum dimension needs at least one of maxWidth or maxHeight.',
  )
  .refine(
    (r) => r.mode !== 'exact' || (r.exactWidth > 0 && r.exactHeight > 0),
    'Resizing to exact dimensions needs both exactWidth and exactHeight.',
  );

export const conversionOptionsSchema = z
  .object({
    targetFormat: formatId,

    /** Ignored by lossless formats. 82 is the usual sweet spot for photographic JPEG. */
    quality: z.number().int().min(1).max(100).default(82),

    /**
     * Target-size mode. When set, native binary-searches quality to land under this
     * size and ignores `quality`. Competitors handle this badly; it is a top request.
     */
    targetByteSize: z.number().int().min(0).default(0),

    resize: resizeSchema.default({
      mode: 'none',
      percent: 100,
      maxWidth: 0,
      maxHeight: 0,
      exactWidth: 0,
      exactHeight: 0,
      allowUpscale: false,
    }),

    rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
    flipHorizontal: z.boolean().default(false),
    flipVertical: z.boolean().default(false),

    /**
     * Default strips GPS but keeps the rest. Location is the metadata people are
     * genuinely surprised to have shared; capture date and camera model are the
     * metadata they are annoyed to lose. Surfaced in the UI as a privacy feature.
     */
    metadata: z.object({ mode: z.enum(metadataModes).default('keepExceptGps') }).default({
      mode: 'keepExceptGps',
    }),

    /**
     * On by default. A Display P3 JPEG renders over-saturated in any app that ignores
     * the embedded profile, which is most of them, and the user reads that as our bug.
     */
    convertToSrgb: z.boolean().default(true),

    /**
     * White by default. Flattening transparency to black is the single most common
     * one-star complaint in this category, and it happens when a converter forgets
     * that JPEG has no alpha channel.
     */
    background: z
      .object({ color: hexColor.default(imageDefaults.backgroundFill) })
      .default({ color: imageDefaults.backgroundFill }),

    lossless: z.boolean().default(false),
    frameIndex: z.number().int().min(0).default(0),
  })
  .superRefine((options, ctx) => {
    const target = FORMATS[options.targetFormat];

    if (target.importOnly) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetFormat'],
        message: `${target.label} can be read but not written. Choose a different output format.`,
      });
    }

    if (options.targetByteSize > 0 && !isLossy(options.targetFormat)) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetByteSize'],
        message:
          `${target.label} has no quality setting, so a target file size cannot be met by ` +
          're-encoding. Resize the image instead.',
      });
    }
  });

export type ConversionOptionsInput = z.input<typeof conversionOptionsSchema>;
export type ConversionOptions = z.output<typeof conversionOptionsSchema>;

/** Formats whose encoder takes a quality parameter. */
export function isLossy(format: FormatId): boolean {
  return format === 'jpeg' || format === 'webp' || format === 'avif' || format === 'heic';
}

/** True when converting to this format discards an alpha channel. */
export function flattensAlpha(format: FormatId): boolean {
  return !FORMATS[format].supportsAlpha;
}

/**
 * Builds a validated options object, applying every default.
 * Throws a `ZodError` whose message names the offending field.
 */
export function buildOptions(input: ConversionOptionsInput): ConversionOptions {
  return conversionOptionsSchema.parse(input);
}

/**
 * Whether the user needs to be asked about a background colour: only when the source
 * actually carries transparency and the destination cannot represent it. Asking when
 * neither is true is noise; not asking when both are is how black backgrounds ship.
 */
export function needsBackgroundChoice(sourceHasAlpha: boolean, target: FormatId): boolean {
  return sourceHasAlpha && flattensAlpha(target);
}
