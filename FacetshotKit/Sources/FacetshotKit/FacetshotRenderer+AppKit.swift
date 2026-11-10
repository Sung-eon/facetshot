#if os(macOS)
import AppKit
import SwiftUI

extension FacetshotRenderer {
    /// An `NSHostingController` as the content of a borderless `NSWindow` at the device's size, drawn with
    /// `cacheDisplay(in:to:)` into a bitmap of the device's scale.
    ///
    /// The window is never put on screen, so nothing flashes and no screen-recording permission is needed. What AppKit
    /// draws this way is the layer tree: layout, text, colors and AppKit controls are right, but behind-window blur and
    /// Liquid Glass are flattened. Phone and pad devices on macOS are an approximation — SwiftUI is told their size
    /// classes, but controls keep their Mac look and metrics; take those on the iOS simulator for the real thing. macOS has
    /// no Dynamic Type, so text-size variants change nothing here unless the views scale text themselves.
    static func render(_ view: AnyView, on device: FacetshotDevice, in variant: FacetshotVariant, layout: FacetshotLayout, wait: Duration, settle: Duration) async throws -> CGImage {
        _ = NSApplication.shared
        let host = NSHostingController(rootView: AnyView(dressed(view, on: device, in: variant)))
        host.sizingOptions = []
        let size = size(for: layout, on: device) { host.sizeThatFits(in: $0) }

        let window = NSWindow(contentRect: CGRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: variant.appearance == .dark ? .darkAqua : .aqua)
        window.contentViewController = host
        window.setContentSize(size)
        let content = host.view
        // A window off screen draws no background of its own, so a Form or List in dark would sit on nothing (light
        // text on the light bitmap): paint the window's background color, as the variant's appearance resolves it.
        content.wantsLayer = true
        window.appearance?.performAsCurrentDrawingAppearance {
            content.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        }
        content.userInterfaceLayoutDirection = variant.layoutDirection == .rightToLeft ? .rightToLeft : .leftToRight
        content.additionalSafeAreaInsets = NSEdgeInsets(top: device.safeArea.top, left: device.safeArea.left, bottom: device.safeArea.bottom, right: device.safeArea.right)
        defer {
            window.contentViewController = nil
            window.close()
        }

        return try await settled(after: wait, within: settle) {
            content.frame = CGRect(origin: .zero, size: size)
            content.layoutSubtreeIfNeeded()
            let picture = try drawn(content, scale: device.scale)
            // A sheet is a window of its own: it is laid over the top middle of its parent, where macOS shows it.
            let sheets = window.sheets.compactMap(\.contentView)
            guard !sheets.isEmpty else { return picture }
            return try composed(picture, scale: device.scale, sheets: sheets.map { try drawn($0, scale: device.scale) })
        }
    }

    private static func drawn(_ view: NSView, scale: Double) throws -> CGImage {
        let size = view.bounds.size
        guard size.width > 0, size.height > 0, let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: Int((size.width * scale).rounded()), pixelsHigh: Int((size.height * scale).rounded()),
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        ) else { throw FacetshotError.renderFailed("no bitmap for \(size)") }
        bitmap.size = size
        view.cacheDisplay(in: view.bounds, to: bitmap)
        guard let picture = bitmap.cgImage else { throw FacetshotError.renderFailed("no image for \(size)") }
        return picture
    }

    private static func composed(_ base: CGImage, scale: Double, sheets: [CGImage]) throws -> CGImage {
        guard let context = CGContext(
            data: nil, width: base.width, height: base.height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { throw FacetshotError.renderFailed("no context to lay a sheet over") }
        context.draw(base, in: CGRect(x: 0, y: 0, width: base.width, height: base.height))
        // The shadow a sheet casts, so its edge shows on a background of its own color.
        context.setShadow(offset: CGSize(width: 0, height: -4 * scale), blur: 24 * scale, color: CGColor(gray: 0, alpha: 0.25))
        for sheet in sheets {
            let x = (base.width - sheet.width) / 2
            context.draw(sheet, in: CGRect(x: max(0, x), y: base.height - sheet.height, width: sheet.width, height: sheet.height))
        }
        guard let image = context.makeImage() else { throw FacetshotError.renderFailed("no image with its sheet") }
        return image
    }
}
#endif
