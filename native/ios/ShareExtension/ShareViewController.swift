// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import PDFKit
import UIKit
import UniformTypeIdentifiers

/// Convert without leaving the app you are in.
///
/// This runs **no JavaScript at all**. A share extension has a hard memory ceiling
/// around 120 MB and has to feel instant; booting a React Native runtime inside one is
/// slow and risks being jetsammed part-way through a conversion. Because the engine is
/// plain Swift rather than something reachable only through a bridge, the extension
/// links the same `RasterCodec` and `PdfEngine` the app uses and calls them directly.
/// That constraint is the reason the whole architecture puts the engine in native code
/// rather than in the JavaScript that drives it.
///
/// What it deliberately does not do is offer everything. A share sheet is a place for
/// one decision, so it offers the three destinations that account for almost every
/// share — JPEG, PNG, and one PDF from all of them — and leaves the rest to the app.
// MARK: - Copy

/// The extension's own copy, from its own bundle.
///
/// It cannot reach the app's i18next catalogue — no JavaScript runs here — so the words
/// come from `Localizable.strings`, which `plugins/withLocalizations.js` generates from
/// that same catalogue at prebuild. One place to translate, and a share sheet that
/// cannot drift out of step with the app behind it.
///
/// `Bundle(for:)` rather than `.main`: inside an extension, `.main` is the extension's
/// bundle on some paths and the host app's on others, and the host here is whatever app
/// the user shared from.
private func L(_ key: String) -> String {
    NSLocalizedString(key, bundle: Bundle(for: ShareViewController.self), comment: "")
}

/// A plural, resolved by the platform against the language's own CLDR categories.
///
/// The ternary this replaces could express exactly two forms. Arabic needs six, and
/// Japanese needs one — neither is expressible as `count == 1 ? a : b`, which is why the
/// counts live in `Localizable.stringsdict` rather than in this file.
private func L(_ key: String, _ count: Int) -> String {
    String.localizedStringWithFormat(L(key), count)
}

@objc(ShareViewController)
final class ShareViewController: UIViewController {

    /// One at a time, always. The ceiling here is low enough that decoding two
    /// 48-megapixel photos at once is the difference between working and being killed.
    private var sources: [URL] = []

    private let card = UIView()
    private let titleLabel = UILabel()
    private let detailLabel = UILabel()
    private let buttonStack = UIStackView()
    private let statusLabel = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private var actionButtons: [UIButton] = []

    private var palette: Tokens.ColorTokens {
        Tokens.colors(dark: traitCollection.userInterfaceStyle == .dark)
    }

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        buildInterface()
        loadAttachments()
    }

    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        applyPalette()
    }

    // MARK: - Input

    /// Copies every attachment into this extension's own container before touching it.
    ///
    /// The URL a provider hands over is only valid for the life of the callback, so
    /// reading it later — after the user has chosen a format — would be reading a file
    /// that is no longer there.
    private func loadAttachments() {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
            .flatMap { $0.attachments ?? [] }

        guard !providers.isEmpty else {
            show(status: L("share.nothingShared"), isProblem: true)
            return
        }

        let group = DispatchGroup()
        var collected: [URL] = []
        let lock = NSLock()

        for provider in providers {
            guard let identifier = fileTypeIdentifier(of: provider) else { continue }
            group.enter()
            provider.loadFileRepresentation(forTypeIdentifier: identifier) { url, _ in
                defer { group.leave() }
                guard let url, let copy = try? Self.copyIntoContainer(url) else { return }
                lock.lock()
                collected.append(copy)
                lock.unlock()
            }
        }

        group.notify(queue: .main) { [weak self] in
            guard let self else { return }
            // Ordered by name so a numbered set of scans becomes a document in the order
            // the user named them, rather than in whatever order the loads finished.
            self.sources = collected.sorted { $0.lastPathComponent < $1.lastPathComponent }
            self.describeInput()
        }
    }

    private func fileTypeIdentifier(of provider: NSItemProvider) -> String? {
        for type in [UTType.image, UTType.pdf] where provider.hasItemConformingToTypeIdentifier(type.identifier) {
            return type.identifier
        }
        return nil
    }

    private static func copyIntoContainer(_ url: URL) throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("Shared", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let destination = FileGateway.resolveCollision(
            directory: directory,
            filename: FileGateway.sanitise(url.lastPathComponent)
        )
        try FileManager.default.copyItem(at: url, to: destination)
        return destination
    }

    private func describeInput() {
        guard !sources.isEmpty else {
            show(status: L("share.unreadable"), isProblem: true)
            return
        }

        let count = sources.count
        titleLabel.text = L("share.title", count)

        let detected = sources.compactMap { try? FormatDetector.detect(url: $0) }
        let labels = Set(detected.compactMap { FormatTable.spec($0.format)?.label })
        detailLabel.text = labels.isEmpty
            ? L("share.ready")
            // `ListFormatter` knows that Arabic separates with ، and Japanese with 、,
            // which a hardcoded ", " does not.
            : ListFormatter.localizedString(byJoining: labels.sorted())

        actionButtons.forEach { $0.isEnabled = true }
    }

    // MARK: - Actions

    @objc private func convertToJpeg() { convertImages(to: "jpeg") }
    @objc private func convertToPng() { convertImages(to: "png") }

    private func convertImages(to format: String) {
        begin(status: L("share.converting"))

        Task.detached(priority: .userInitiated) { [sources] in
            var written: [URL] = []
            var failures = 0

            for source in sources {
                // One file per pass, each one released before the next begins. Peak cost
                // is a single image rather than the whole share.
                autoreleasepool {
                    var options = RasterCodec.Options()
                    options.targetFormat = format
                    do {
                        let result = try RasterCodec.convert(
                            inputURL: source,
                            outputURL: nil,
                            options: options
                        )
                        written.append(result.outputURL)
                    } catch {
                        failures += 1
                    }
                }
            }

            await self.finishImages(written: written, failures: failures)
        }
    }

    @objc private func convertToPdf() {
        begin(status: L("share.makingPdf"))

        Task.detached(priority: .userInitiated) { [sources] in
            do {
                let output = FileGateway.resolveCollision(
                    directory: try RasterCodec.managedOutputDirectory(),
                    filename: "Shared.pdf"
                )
                var options = PdfEngine.ComposeOptions(dictionary: [:])
                // "Fit image" rather than A4: a share is usually screenshots or photos,
                // and putting a screenshot on a letter-sized page is mostly margin.
                options.pageSize = "fit"
                _ = try PdfEngine.composeFromImages(
                    imageURLs: sources,
                    outputURL: output,
                    options: options
                )
                await self.offerToSave(output)
            } catch {
                await self.show(status: L("share.pdfFailed"), isProblem: true)
            }
        }
    }

    @MainActor
    private func finishImages(written: [URL], failures: Int) async {
        guard !written.isEmpty else {
            show(status: L("share.nothingConverted"), isProblem: true)
            return
        }

        do {
            try await FileGateway.saveToPhotos(urls: written)
            // Two whole sentences rather than one with a count spliced into it: both
            // halves inflect on their own count, and only sentence-level joining stays
            // correct across nine languages.
            let saved = L("share.savedToPhotos", written.count)
            show(status: failures == 0 ? saved : "\(saved) \(L("share.someUnreadable", failures))")
            // Left up briefly so the outcome is read rather than glimpsed.
            try? await Task.sleep(nanoseconds: 900_000_000)
            close()
        } catch {
            // Adding to the library is the one thing here that can be refused, and the
            // files still exist — offering them is better than reporting a dead end.
            show(status: L("share.photosDenied"), isProblem: true)
            offerToSave(written)
        }
    }

    @MainActor
    private func offerToSave(_ url: URL) { offerToSave([url]) }

    @MainActor
    private func offerToSave(_ urls: [URL]) {
        spinner.stopAnimating()
        let sheet = UIActivityViewController(activityItems: urls, applicationActivities: nil)
        sheet.completionWithItemsHandler = { [weak self] _, _, _, _ in self?.close() }
        sheet.popoverPresentationController?.sourceView = card
        present(sheet, animated: true)
    }

    @objc private func cancel() {
        extensionContext?.cancelRequest(withError: NSError(domain: "converter", code: 0))
    }

    private func close() {
        extensionContext?.completeRequest(returningItems: nil)
    }

    // MARK: - Interface

    @MainActor
    private func begin(status: String) {
        actionButtons.forEach { $0.isEnabled = false }
        spinner.startAnimating()
        show(status: status)
    }

    @MainActor
    private func show(status: String, isProblem: Bool = false) {
        if !spinner.isAnimating || isProblem { spinner.stopAnimating() }
        statusLabel.text = status
        statusLabel.textColor = colour(isProblem ? palette.dangerInk : palette.textSecondary)
        statusLabel.isHidden = false
    }

    private func buildInterface() {
        view.backgroundColor = colour(palette.bgScrim)

        card.translatesAutoresizingMaskIntoConstraints = false
        card.layer.cornerRadius = Tokens.Radius.lg
        view.addSubview(card)

        titleLabel.font = .systemFont(ofSize: Tokens.Typography.h2.fontSize, weight: .bold)
        titleLabel.numberOfLines = 2
        titleLabel.text = L("share.reading")

        detailLabel.font = .systemFont(ofSize: Tokens.Typography.bodySm.fontSize)
        detailLabel.numberOfLines = 2

        statusLabel.font = .systemFont(ofSize: Tokens.Typography.bodySm.fontSize)
        statusLabel.numberOfLines = 3
        statusLabel.isHidden = true

        actionButtons = [
            makeButton(title: L("share.saveAsJpg"), action: #selector(convertToJpeg), prominent: true),
            makeButton(title: L("share.saveAsPng"), action: #selector(convertToPng), prominent: false),
            makeButton(title: L("share.makePdf"), action: #selector(convertToPdf), prominent: false),
        ]
        actionButtons.forEach { $0.isEnabled = false }

        buttonStack.axis = .vertical
        buttonStack.spacing = Tokens.Space.sm
        actionButtons.forEach(buttonStack.addArrangedSubview)

        let cancelButton = makeButton(title: L("share.cancel"), action: #selector(cancel), prominent: false)
        cancelButton.setTitleColor(colour(palette.textSecondary), for: .normal)
        cancelButton.backgroundColor = .clear

        let stack = UIStackView(arrangedSubviews: [
            titleLabel, detailLabel, spinner, statusLabel, buttonStack, cancelButton,
        ])
        stack.axis = .vertical
        stack.spacing = Tokens.Space.md
        stack.setCustomSpacing(Tokens.Space.xl, after: statusLabel)
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        let inset = Tokens.Space.xl
        NSLayoutConstraint.activate([
            card.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: inset),
            card.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -inset),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),

            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: inset),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -inset),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: inset),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -inset),
        ])

        applyPalette()
    }

    private func makeButton(title: String, action: Selector, prominent: Bool) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(title, for: .normal)
        button.titleLabel?.font = .systemFont(
            ofSize: Tokens.Typography.body.fontSize,
            weight: prominent ? .semibold : .regular
        )
        button.layer.cornerRadius = Tokens.Radius.md
        button.contentEdgeInsets = UIEdgeInsets(
            top: Tokens.Space.md,
            left: Tokens.Space.lg,
            bottom: Tokens.Space.md,
            right: Tokens.Space.lg
        )
        button.addTarget(self, action: action, for: .touchUpInside)
        button.tag = prominent ? 1 : 0
        return button
    }

    /// The same tokens the app is built from, so the sheet is recognisably part of it.
    private func applyPalette() {
        let colors = palette
        view.backgroundColor = colour(colors.bgScrim)
        card.backgroundColor = colour(colors.bgSurface)
        titleLabel.textColor = colour(colors.textPrimary)
        detailLabel.textColor = colour(colors.textSecondary)
        spinner.color = colour(colors.accentInk)

        for button in actionButtons {
            let prominent = button.tag == 1
            button.backgroundColor = colour(prominent ? colors.accentDeep : colors.bgSunken)
            button.setTitleColor(
                colour(prominent ? colors.textOnAccentDeep : colors.textPrimary),
                for: .normal
            )
            button.setTitleColor(colour(colors.textDisabled), for: .disabled)
        }
    }

    /// Straight sRGB, exactly as the generated tokens store it.
    private func colour(_ rgba: Tokens.RGBA) -> UIColor {
        UIColor(red: rgba.red, green: rgba.green, blue: rgba.blue, alpha: rgba.alpha)
    }
}
