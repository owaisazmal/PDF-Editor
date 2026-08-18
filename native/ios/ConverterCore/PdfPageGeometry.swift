// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import CoreGraphics
import Foundation

/// Page geometry, shared by composition on both platforms.
///
/// PDF measures everything in points at 1/72 inch, and these are the ISO 216 and ANSI
/// sizes expressed in that unit. They are written out rather than computed from
/// millimetres because a rounding difference between the two platforms would show up as
/// a document that reflows when it crosses devices.
///
/// Mirrors `PdfPageGeometry.kt`.
public enum PdfPageGeometry {

    public struct Size: Sendable {
        public let width: Double
        public let height: Double

        public init(width: Double, height: Double) {
            self.width = width
            self.height = height
        }

        public var swapped: Size { Size(width: height, height: width) }
        public var cgSize: CGSize { CGSize(width: width, height: height) }
    }

    /// `fit` is not in this table: it means "use each image's own aspect ratio", so the
    /// page size is decided per image rather than chosen from a list.
    public static let named: [String: Size] = [
        "a3": Size(width: 841.89, height: 1190.55),
        "a4": Size(width: 595.28, height: 841.89),
        "a5": Size(width: 419.53, height: 595.28),
        "letter": Size(width: 612, height: 792),
        "legal": Size(width: 612, height: 1008),
        "tabloid": Size(width: 792, height: 1224),
    ]

    /// The page a single image occupies, before margins.
    ///
    /// `fit` sizes the page to the image, which is what people expect when they turn a
    /// screenshot into a PDF — a screenshot on A4 is a screenshot with a large white
    /// border. Everything else is a fixed paper size, oriented to match the image unless
    /// the caller insists.
    public static func page(
        named name: String,
        orientation: String,
        imageWidth: Double,
        imageHeight: Double,
        dpi: Double
    ) -> Size {
        if name == "fit" {
            // Converted at the requested density rather than treating pixels as points,
            // so a 300 DPI scan does not become a poster.
            let scale = 72.0 / max(dpi, 1)
            return Size(width: imageWidth * scale, height: imageHeight * scale)
        }

        let base = named[name] ?? named["a4"]!

        switch orientation {
        case "portrait": return base
        case "landscape": return base.swapped
        default:
            // `auto`: a landscape photo on a portrait page wastes half the sheet.
            return imageWidth > imageHeight ? base.swapped : base
        }
    }

    /// Where an image sits inside its slot, for the three fit modes.
    ///
    /// `fit` never crops and never enlarges past the slot. `fill` covers the slot and
    /// crops the overflow. `stretch` distorts, and exists only because some users
    /// genuinely want the whole slot filled and do not care.
    public static func placement(
        imageWidth: Double,
        imageHeight: Double,
        slot: CGRect,
        mode: String
    ) -> CGRect {
        guard imageWidth > 0, imageHeight > 0, slot.width > 0, slot.height > 0 else {
            return slot
        }

        if mode == "stretch" { return slot }

        let scaleX = slot.width / imageWidth
        let scaleY = slot.height / imageHeight
        let scale = mode == "fill" ? max(scaleX, scaleY) : min(scaleX, scaleY)

        let width = imageWidth * scale
        let height = imageHeight * scale

        return CGRect(
            x: slot.midX - width / 2,
            y: slot.midY - height / 2,
            width: width,
            height: height
        )
    }

    /// The slots an N-up page is divided into, in reading order.
    ///
    /// Laid out as a grid rather than a strip: two-up on a portrait page is two
    /// landscape halves stacked, which is how a scanned booklet is read.
    ///
    /// Coordinates have a **top-left origin**, matching Android's `Canvas` and the
    /// UIKit-configured context that `UIGraphicsPDFRenderer` hands out. PDF's own
    /// bottom-left space never surfaces here, so the two platforms cannot disagree
    /// about which corner page one starts in.
    public static func slots(in box: CGRect, count: Int, gutter: Double) -> [CGRect] {
        let columns: Int
        let rows: Int

        switch max(count, 1) {
        case 1: (columns, rows) = (1, 1)
        case 2: (columns, rows) = box.width > box.height ? (2, 1) : (1, 2)
        case 4: (columns, rows) = (2, 2)
        case 6: (columns, rows) = box.width > box.height ? (3, 2) : (2, 3)
        case 9: (columns, rows) = (3, 3)
        default: (columns, rows) = (1, 1)
        }

        let cellWidth = (box.width - gutter * Double(columns - 1)) / Double(columns)
        let cellHeight = (box.height - gutter * Double(rows - 1)) / Double(rows)
        guard cellWidth > 0, cellHeight > 0 else { return [box] }

        var result: [CGRect] = []
        for row in 0..<rows {
            for column in 0..<columns {
                result.append(
                    CGRect(
                        x: box.minX + Double(column) * (cellWidth + gutter),
                        y: box.minY + Double(row) * (cellHeight + gutter),
                        width: cellWidth,
                        height: cellHeight
                    )
                )
            }
        }
        return result
    }

    /// Expands `1-3,7,9-` into zero-based page indices, clamped to the document.
    ///
    /// One-based and inclusive on the way in, because that is what a page number means
    /// to the person typing it and every PDF tool they have used before.
    public static func expand(ranges: String, pageCount: Int) -> [Int] {
        let trimmed = ranges.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, pageCount > 0 else { return Array(0..<max(pageCount, 0)) }

        var pages: [Int] = []
        var seen = Set<Int>()

        for part in trimmed.split(separator: ",") {
            let piece = part.trimmingCharacters(in: .whitespaces)
            guard !piece.isEmpty else { continue }

            let bounds = piece
                .split(separator: "-", omittingEmptySubsequences: false)
                // Trimmed before parsing: `Int(" 1 ")` is nil, and " 1 - 2 " is exactly
                // how people type a range.
                .map { $0.trimmingCharacters(in: .whitespaces) }
            let first: Int
            let last: Int

            if bounds.count == 1 {
                guard let single = Int(bounds[0]) else { continue }
                first = single
                last = single
            } else {
                // An open end means "to the end of the document", so `9-` on a 12-page
                // file is the last four pages. A non-empty end that is not a number is a
                // typo rather than an open end, and drops the whole part.
                let start = Int(bounds[0])
                let end = Int(bounds[1])
                if start == nil, !bounds[0].isEmpty { continue }
                if end == nil, !bounds[1].isEmpty { continue }
                first = start ?? 1
                last = end ?? pageCount
            }

            let lower = max(1, min(first, last))
            let upper = min(pageCount, max(first, last))
            guard lower <= upper else { continue }

            for page in lower...upper where !seen.contains(page - 1) {
                seen.insert(page - 1)
                pages.append(page - 1)
            }
        }

        // An unparseable range is not silently the whole document: that would quietly
        // export 400 pages when the user asked for three.
        return pages
    }
}
