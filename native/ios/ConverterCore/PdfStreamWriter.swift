// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import CoreGraphics
import Foundation

/// Writes a PDF of JPEG pages straight to disk, one page at a time. CoreGraphics' PDF
/// context keeps every image until it closes, so 400 photos peaked above a gigabyte.
final class PdfStreamWriter {

    /// One JPEG on a page. Rectangles are in points, top-left origin, as `PdfPageGeometry` uses.
    struct Image {
        let jpeg: Data
        let pixelWidth: Int
        let pixelHeight: Int
        let grayscale: Bool
        let frame: CGRect
        let clip: CGRect?
    }

    private let handle: FileHandle
    private var position = 0
    private var offsets: [Int: Int] = [:]
    private var nextObject = 3
    private var pages: [Int] = []

    init(url: URL) throws {
        guard FileManager.default.createFile(atPath: url.path, contents: nil) else {
            throw ConversionError.diskFull
        }
        handle = try FileHandle(forWritingTo: url)
        try write(Data([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A, 0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]))
    }

    deinit {
        try? handle.close()
    }

    var pageCount: Int { pages.count }

    func addPage(size: CGSize, background: (red: Double, green: Double, blue: Double), images: [Image]) throws {
        var names: [String] = []
        for image in images {
            let object = reserve()
            try begin(object)
            try write("<< /Type /XObject /Subtype /Image /Width \(image.pixelWidth) /Height \(image.pixelHeight) "
                + "/ColorSpace /\(image.grayscale ? "DeviceGray" : "DeviceRGB") /BitsPerComponent 8 "
                + "/Filter /DCTDecode /Length \(image.jpeg.count) >>\nstream\n")
            try write(image.jpeg)
            try write("\nendstream\nendobj\n")
            names.append("/Im\(names.count) \(object) 0 R")
        }

        let height = size.height
        var content = "q \(number(background.red)) \(number(background.green)) \(number(background.blue)) rg "
            + "0 0 \(number(size.width)) \(number(height)) re f Q\n"
        for (index, image) in images.enumerated() {
            content += "q "
            if let clip = image.clip {
                content += "\(number(clip.minX)) \(number(height - clip.maxY)) \(number(clip.width)) \(number(clip.height)) re W n "
            }
            content += "\(number(image.frame.width)) 0 0 \(number(image.frame.height)) "
                + "\(number(image.frame.minX)) \(number(height - image.frame.maxY)) cm /Im\(index) Do Q\n"
        }
        let contentData = Data(content.utf8)
        let contents = reserve()
        try begin(contents)
        try write("<< /Length \(contentData.count) >>\nstream\n")
        try write(contentData)
        try write("\nendstream\nendobj\n")

        let page = reserve()
        try begin(page)
        try write("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 \(number(size.width)) \(number(height))] "
            + "/Resources << /XObject << \(names.joined(separator: " ")) >> /ProcSet [/PDF /ImageB /ImageC] >> "
            + "/Contents \(contents) 0 R >>\nendobj\n")
        pages.append(page)
    }

    /// Writes the page tree, catalogue and cross-reference table, and closes the file.
    func finish() throws {
        try begin(2)
        try write("<< /Type /Pages /Kids [\(pages.map { "\($0) 0 R" }.joined(separator: " "))] /Count \(pages.count) >>\nendobj\n")
        try begin(1)
        try write("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")

        let table = position
        let count = nextObject
        var xref = "xref\n0 \(count)\n0000000000 65535 f \n"
        for object in 1..<count {
            xref += String(format: "%010ld 00000 n \n", offsets[object] ?? 0)
        }
        xref += "trailer\n<< /Size \(count) /Root 1 0 R >>\nstartxref\n\(table)\n%%EOF\n"
        try write(xref)
        try handle.close()
    }

    private func reserve() -> Int {
        defer { nextObject += 1 }
        return nextObject
    }

    private func begin(_ object: Int) throws {
        offsets[object] = position
        try write("\(object) 0 obj\n")
    }

    private func write(_ string: String) throws {
        try write(Data(string.utf8))
    }

    private func write(_ data: Data) throws {
        do {
            try handle.write(contentsOf: data)
        } catch {
            throw ConversionError.diskFull
        }
        position += data.count
    }

    /// PDF numbers: no exponent, no locale, and no more precision than a point needs.
    private func number(_ value: Double) -> String {
        let rounded = (value * 1000).rounded() / 1000
        if rounded == rounded.rounded() { return String(Int(rounded)) }
        return String(format: "%.3f", rounded)
    }

    private func number(_ value: CGFloat) -> String {
        number(Double(value))
    }
}

extension PdfStreamWriter {

    /// Colour components from a JPEG's frame header. Nil when the data is not a JPEG.
    static func jpegComponents(_ data: Data) -> Int? {
        let bytes = [UInt8](data.prefix(256 * 1024))
        guard bytes.count > 4, bytes[0] == 0xFF, bytes[1] == 0xD8 else { return nil }
        var index = 2
        while index + 9 < bytes.count {
            guard bytes[index] == 0xFF else { return nil }
            let marker = bytes[index + 1]
            if marker == 0xFF { index += 1; continue }
            let length = Int(bytes[index + 2]) << 8 | Int(bytes[index + 3])
            let isFrame = (0xC0...0xCF).contains(marker) && marker != 0xC4 && marker != 0xC8 && marker != 0xCC
            if isFrame { return Int(bytes[index + 9]) }
            index += 2 + length
        }
        return nil
    }
}
