import SwiftUI

/// How big the picture of a scene is.
public enum FacetshotLayout: Sendable, Equatable {
    /// The whole screen (or window) of the device: the PNG is `width × scale` by `height × scale`, whatever the content's size.
    case device
    /// The device's width, and as tall as the content wants to be. For components rather than screens.
    case sizeThatFits
    /// A fixed size in points, the same on every device.
    case fixed(width: Double, height: Double)
}

/// One thing to take a picture of: a name and a function that makes the view.
///
/// ```swift
/// FacetshotScene("Book/Page") { PageView(page: .fixture) }
/// FacetshotScene("Button/Primary", layout: .sizeThatFits, devices: ["phone"]) { PrimaryButton("Save") {} }
/// ```
///
/// The id is a path of segments separated by `/`; it names the output folder (`/` becomes `__`) and is what
/// `FACETSHOT_SCENES` globs match. The view is made fresh for every device × variant, so state never leaks between pictures.
///
/// Scenes are plain values, so a list can come from anywhere — that is the extension point for scenes found at run time
/// rather than written out. FacetshotKit does not enumerate `#Preview`s itself (the README says why), but a test target
/// that already depends on EmergeTools' SnapshotPreviews can turn its previews into scenes:
///
/// ```swift
/// import SnapshotPreviewsCore
///
/// @MainActor func previewScenes() -> [FacetshotScene] {
///     FindPreviews.findPreviews(included: nil, excluded: nil).flatMap { type in
///         type.previews.map { preview in
///             // `Preview` is not `Sendable`; it is only ever touched on the main actor.
///             nonisolated(unsafe) let preview = preview
///             let id = "Previews/\(type.displayName)/\(preview.displayName ?? String(preview.index))"
///             return FacetshotScene(id, tags: ["preview"]) { AnyView(preview.view()) }
///         }
///     }
/// }
/// ```
public struct FacetshotScene: Sendable, Identifiable {
    public let id: String
    /// A human title for listings; defaults to the id's last segment.
    public var title: String
    /// Free-form labels, passed through to `scenes.json`.
    public var tags: [String]
    /// Only these devices (by device `name` or `idiom`: `phone`, `pad`, `mac`). `nil` = every device.
    public var devices: Set<String>?
    /// Only these variants (by variant `name`). `nil` = every variant.
    public var variants: Set<String>?
    public var layout: FacetshotLayout
    /// How long to wait before the first picture is compared, for a scene that does something on a timer (a toast that
    /// comes after a second): a still frame before then does not end the wait. Added to the run's settle time.
    public var wait: Duration
    let make: @MainActor @Sendable () throws -> AnyView

    public init<Content: View>(
        _ id: String,
        title: String? = nil,
        tags: [String] = [],
        layout: FacetshotLayout = .device,
        devices: Set<String>? = nil,
        variants: Set<String>? = nil,
        wait: Duration = .zero,
        @ViewBuilder content: @escaping @MainActor @Sendable () throws -> Content
    ) {
        self.id = id
        self.title = title ?? String(id.split(separator: "/").last ?? Substring(id))
        self.tags = tags
        self.layout = layout
        self.devices = devices
        self.variants = variants
        self.wait = wait
        self.make = { AnyView(try content()) }
    }

    /// Whether this scene is taken on `device` in `variant`.
    public func applies(to device: FacetshotDevice, _ variant: FacetshotVariant) -> Bool {
        let deviceOK = devices.map { $0.contains(device.name) || $0.contains(device.idiom.rawValue) } ?? true
        let variantOK = variants.map { $0.contains(variant.name) } ?? true
        return deviceOK && variantOK
    }

    /// The folder this scene's pictures go in, relative to the output folder.
    public var folderName: String { id.replacingOccurrences(of: "/", with: "__") }
}
