// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.core

import android.graphics.RectF
import kotlin.math.max
import kotlin.math.min

/**
 * Page geometry, shared by composition on both platforms.
 *
 * PDF measures everything in points at 1/72 inch, and these are the ISO 216 and ANSI
 * sizes expressed in that unit. They are written out rather than computed from
 * millimetres because a rounding difference between the two platforms would show up as a
 * document that reflows when it crosses devices.
 *
 * Mirrors `PdfPageGeometry.swift`, including the top-left coordinate origin.
 */
public object PdfPageGeometry {

  public data class Size(val width: Double, val height: Double) {
    public val swapped: Size get() = Size(height, width)
  }

  /**
   * `fit` is not in this table: it means "use each image's own aspect ratio", so the page
   * size is decided per image rather than chosen from a list.
   */
  public val named: Map<String, Size> = mapOf(
    "a3" to Size(841.89, 1190.55),
    "a4" to Size(595.28, 841.89),
    "a5" to Size(419.53, 595.28),
    "letter" to Size(612.0, 792.0),
    "legal" to Size(612.0, 1008.0),
    "tabloid" to Size(792.0, 1224.0),
  )

  /**
   * The page a single image occupies, before margins.
   *
   * `fit` sizes the page to the image, which is what people expect when they turn a
   * screenshot into a PDF — a screenshot on A4 is a screenshot with a large white border.
   * Everything else is a fixed paper size, oriented to match the image unless the caller
   * insists.
   */
  @JvmStatic
  public fun page(
    name: String,
    orientation: String,
    imageWidth: Double,
    imageHeight: Double,
    dpi: Double,
  ): Size {
    if (name == "fit") {
      // Converted at the requested density rather than treating pixels as points, so a
      // 300 DPI scan does not become a poster.
      val scale = 72.0 / max(dpi, 1.0)
      return Size(imageWidth * scale, imageHeight * scale)
    }

    val base = named[name] ?: named.getValue("a4")

    return when (orientation) {
      "portrait" -> base
      "landscape" -> base.swapped
      // `auto`: a landscape photo on a portrait page wastes half the sheet.
      else -> if (imageWidth > imageHeight) base.swapped else base
    }
  }

  /**
   * Where an image sits inside its slot, for the three fit modes.
   *
   * `fit` never crops and never enlarges past the slot. `fill` covers the slot and crops
   * the overflow. `stretch` distorts, and exists only because some users genuinely want
   * the whole slot filled and do not care.
   */
  @JvmStatic
  public fun placement(
    imageWidth: Double,
    imageHeight: Double,
    slot: RectF,
    mode: String,
  ): RectF {
    if (imageWidth <= 0 || imageHeight <= 0 || slot.width() <= 0 || slot.height() <= 0) {
      return RectF(slot)
    }
    if (mode == "stretch") return RectF(slot)

    val scaleX = slot.width() / imageWidth
    val scaleY = slot.height() / imageHeight
    val scale = if (mode == "fill") max(scaleX, scaleY) else min(scaleX, scaleY)

    val width = imageWidth * scale
    val height = imageHeight * scale
    val centerX = slot.centerX()
    val centerY = slot.centerY()

    return RectF(
      (centerX - width / 2).toFloat(),
      (centerY - height / 2).toFloat(),
      (centerX + width / 2).toFloat(),
      (centerY + height / 2).toFloat(),
    )
  }

  /**
   * The slots an N-up page is divided into, in reading order.
   *
   * Laid out as a grid rather than a strip: two-up on a portrait page is two landscape
   * halves stacked, which is how a scanned booklet is read. Coordinates have a top-left
   * origin, matching `Canvas` here and the UIKit-configured context on iOS.
   */
  @JvmStatic
  public fun slots(box: RectF, count: Int, gutter: Double): List<RectF> {
    val landscape = box.width() > box.height()
    val (columns, rows) = when (max(count, 1)) {
      1 -> 1 to 1
      2 -> if (landscape) 2 to 1 else 1 to 2
      4 -> 2 to 2
      6 -> if (landscape) 3 to 2 else 2 to 3
      9 -> 3 to 3
      else -> 1 to 1
    }

    val cellWidth = (box.width() - gutter * (columns - 1)) / columns
    val cellHeight = (box.height() - gutter * (rows - 1)) / rows
    if (cellWidth <= 0 || cellHeight <= 0) return listOf(RectF(box))

    return buildList {
      for (row in 0 until rows) {
        for (column in 0 until columns) {
          val left = box.left + column * (cellWidth + gutter)
          val top = box.top + row * (cellHeight + gutter)
          add(
            RectF(
              left.toFloat(),
              top.toFloat(),
              (left + cellWidth).toFloat(),
              (top + cellHeight).toFloat(),
            ),
          )
        }
      }
    }
  }

  /**
   * Expands `1-3,7,9-` into zero-based page indices, clamped to the document.
   *
   * One-based and inclusive on the way in, because that is what a page number means to
   * the person typing it and every PDF tool they have used before.
   */
  @JvmStatic
  public fun expand(ranges: String, pageCount: Int): List<Int> {
    val trimmed = ranges.trim()
    if (trimmed.isEmpty() || pageCount <= 0) return (0 until max(pageCount, 0)).toList()

    val pages = mutableListOf<Int>()
    val seen = mutableSetOf<Int>()

    for (part in trimmed.split(",")) {
      val piece = part.trim()
      if (piece.isEmpty()) continue

      // Trimmed before parsing: `" 1 ".toIntOrNull()` is null, and " 1 - 2 " is
      // exactly how people type a range.
      val bounds = piece.split("-").map { it.trim() }
      val first: Int
      val last: Int

      if (bounds.size == 1) {
        val single = bounds[0].toIntOrNull() ?: continue
        first = single
        last = single
      } else {
        // An open end means "to the end of the document", so `9-` on a 12-page file is
        // the last four pages. A non-empty end that is not a number is a typo rather
        // than an open end, and drops the whole part.
        val start = bounds[0].toIntOrNull()
        val end = bounds[1].toIntOrNull()
        if (start == null && bounds[0].isNotEmpty()) continue
        if (end == null && bounds[1].isNotEmpty()) continue
        first = start ?: 1
        last = end ?: pageCount
      }

      val lower = max(1, min(first, last))
      val upper = min(pageCount, max(first, last))
      if (lower > upper) continue

      for (page in lower..upper) {
        if (seen.add(page - 1)) pages.add(page - 1)
      }
    }

    // An unparseable range is not silently the whole document: that would quietly export
    // 400 pages when the user asked for three.
    return pages
  }
}
