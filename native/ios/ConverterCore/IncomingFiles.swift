// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import Foundation
import UIKit
import UniformTypeIdentifiers

/// Files handed to the app from outside it.
///
/// On iOS an Open With arrives as a URL through the linking system, which JavaScript
/// already observes, so this queue exists for the door that has no such path: a **drop**
/// onto the window. The share extension does its own work and never comes through here.
///
/// Anything dropped is copied into the app's own storage before it is queued. A dropped
/// item's URL belongs to the sending app and is valid only for the length of the drop
/// session, so a file left as a reference would stop being readable at the worst possible
/// moment — usually part-way through a batch the user has walked away from.
public enum IncomingFiles {

    private static let lock = NSLock()
    private static var queue: [DetectedFile] = []
    private static var onArrival: (() -> Void)?

    /// Set once by the TurboModule. Nothing listens in the share extension.
    public static func setArrivalHandler(_ handler: (() -> Void)?) {
        lock.lock()
        onArrival = handler
        lock.unlock()
    }

    /// Drains the queue. Taking rather than reading means a reload cannot resurrect files
    /// the user has already dealt with.
    public static func take() -> [[String: Any]] {
        lock.lock()
        let drained = queue
        queue.removeAll()
        lock.unlock()
        return drained.map(\.dictionaryRepresentation)
    }

    private static func add(_ files: [DetectedFile]) {
        guard !files.isEmpty else { return }
        lock.lock()
        queue.append(contentsOf: files)
        let notify = onArrival
        lock.unlock()
        DispatchQueue.main.async { notify?() }
    }

    // MARK: - Drops

    /// Installs the drop target on the app's root view, once.
    ///
    /// Called from `takePendingFiles`, which JavaScript already invokes at startup and on
    /// every return to the foreground — by which point a root view certainly exists.
    /// Doing it at module construction instead races the first render.
    @MainActor
    public static func installDropTarget(on view: UIView?) {
        guard let view else { return }
        // Idempotent: a second interaction would deliver every drop twice.
        guard !view.interactions.contains(where: { $0 is UIDropInteraction }) else { return }
        view.addInteraction(UIDropInteraction(delegate: DropDelegate.shared))
    }

    /// Accepts images and PDFs dropped onto the window.
    ///
    /// A drop is the third door into the same queue, so it deliberately ends in the same
    /// place a share does: detected files, and a screen that asks what to do with them.
    private final class DropDelegate: NSObject, UIDropInteractionDelegate {
        static let shared = DropDelegate()

        private var acceptedTypes: [UTType] { [.image, .pdf] }

        func dropInteraction(
            _ interaction: UIDropInteraction,
            canHandle session: any UIDropSession
        ) -> Bool {
            session.hasItemsConforming(toTypeIdentifiers: acceptedTypes.map(\.identifier))
        }

        func dropInteraction(
            _ interaction: UIDropInteraction,
            sessionDidUpdate session: any UIDropSession
        ) -> UIDropProposal {
            // Copy rather than move: the file belongs to whoever sent it, and converting
            // is a read. Nothing this app does should remove someone else's original.
            UIDropProposal(operation: .copy)
        }

        func dropInteraction(
            _ interaction: UIDropInteraction,
            performDrop session: any UIDropSession
        ) {
            let group = DispatchGroup()
            var collected: [DetectedFile] = []
            let collectionLock = NSLock()

            for item in session.items {
                guard let identifier = typeIdentifier(for: item.itemProvider) else { continue }
                group.enter()
                item.itemProvider.loadFileRepresentation(
                    forTypeIdentifier: identifier
                ) { url, _ in
                    defer { group.leave() }
                    guard let url,
                          let local = try? IncomingFiles.copyIntoContainer(url),
                          let detected = try? FormatDetector.detect(url: local)
                    else { return }

                    collectionLock.lock()
                    collected.append(detected)
                    collectionLock.unlock()
                }
            }

            group.notify(queue: .main) {
                // Ordered by name so a numbered set of scans keeps the order it was named
                // in, rather than the order the loads happened to finish in.
                IncomingFiles.add(collected.sorted { $0.displayName < $1.displayName })
            }
        }

        private func typeIdentifier(for provider: NSItemProvider) -> String? {
            for type in acceptedTypes
            where provider.hasItemConformingToTypeIdentifier(type.identifier) {
                return type.identifier
            }
            return nil
        }
    }

    private static func copyIntoContainer(_ url: URL) throws -> URL {
        let directory = FileGateway.temporaryDirectory()
            .appendingPathComponent("Dropped", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let destination = FileGateway.resolveCollision(
            directory: directory,
            filename: FileGateway.sanitise(url.lastPathComponent)
        )
        try FileManager.default.copyItem(at: url, to: destination)
        return destination
    }
}
