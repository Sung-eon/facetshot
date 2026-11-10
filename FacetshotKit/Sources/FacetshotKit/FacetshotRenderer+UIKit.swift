#if os(iOS) || os(tvOS) || os(visionOS)
import SwiftUI
import UIKit

extension FacetshotRenderer {
    /// A `UIHostingController` as the root of its own `UIWindow` at the device's size.
    ///
    /// In a test with an app host, the window joins the host's scene and is drawn with
    /// `drawHierarchy(in:afterScreenUpdates:)`: what the render server shows, so materials, Liquid Glass and presented
    /// sheets and dialogs are in the picture. In a test with no app host (a Swift package's tests) there is no scene, and
    /// the layer tree is drawn with `CALayer.render(in:)`: layout, text, colors and UIKit-backed views (List, ScrollView,
    /// TextField) are right, but glass and blur are flat and presentations do not appear.
    static func render(_ view: AnyView, on device: FacetshotDevice, in variant: FacetshotVariant, layout: FacetshotLayout, wait: Duration, settle: Duration) async throws -> CGImage {
        let host = UIHostingController(rootView: AnyView(dressed(view, on: device, in: variant)))
        host.additionalSafeAreaInsets = UIEdgeInsets(top: device.safeArea.top, left: device.safeArea.left, bottom: device.safeArea.bottom, right: device.safeArea.right)
        let size = size(for: layout, on: device) { host.sizeThatFits(in: $0) }

        let window = makeWindow(frame: CGRect(origin: .zero, size: size))
        apply(device, variant, to: &window.traitOverrides)
        apply(device, variant, to: &host.traitOverrides)
        window.overrideUserInterfaceStyle = variant.appearance == .dark ? .dark : .light
        window.semanticContentAttribute = variant.layoutDirection == .rightToLeft ? .forceRightToLeft : .forceLeftToRight
        window.rootViewController = host
        window.isHidden = false
        defer {
            host.presentedViewController?.dismiss(animated: false)
            window.isHidden = true
            window.rootViewController = nil
        }

        let format = UIGraphicsImageRendererFormat()
        format.scale = device.scale
        format.opaque = layout == .device
        format.preferredRange = .standard
        // Without a window scene (a test with no app host) there is no render server to draw for us, and asking it only
        // logs an error each time: the layer tree is drawn instead (see the README for what that leaves out).
        let onScreen = window.windowScene != nil
        return try await settled(after: wait, within: settle) {
            window.layoutIfNeeded()
            CATransaction.flush()
            let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { context in
                if !onScreen || !window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) {
                    window.layer.render(in: context.cgContext)
                }
            }
            guard let picture = image.cgImage else { throw FacetshotError.renderFailed("no image for \(size)") }
            return picture
        }
    }

    /// A window in the test host's scene when there is one (an app-hosted test), else a free-standing one.
    private static func makeWindow(frame: CGRect) -> UIWindow {
        // `UIApplication.shared` traps in a test with no app host, so it is asked for the way that answers nil.
        let application = UIApplication.value(forKey: "sharedApplication") as? UIApplication
        let scene = application?.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        let window = scene.map { UIWindow(windowScene: $0) } ?? UIWindow(frame: frame)
        window.frame = frame
        return window
    }

    private static func apply(_ device: FacetshotDevice, _ variant: FacetshotVariant, to traits: inout some UIMutableTraits) {
        traits.userInterfaceStyle = variant.appearance == .dark ? .dark : .light
        traits.horizontalSizeClass = device.horizontalSizeClass == .compact ? .compact : .regular
        traits.verticalSizeClass = device.verticalSizeClass == .compact ? .compact : .regular
        traits.layoutDirection = variant.layoutDirection == .rightToLeft ? .rightToLeft : .leftToRight
        traits.preferredContentSizeCategory = UIContentSizeCategory(variant.dynamicType ?? .large)
        traits.displayScale = device.scale
        traits.accessibilityContrast = variant.increasedContrast ? .high : .normal
        traits.userInterfaceIdiom = switch device.idiom {
        case .phone: .phone
        case .pad: .pad
        case .mac: .mac
        }
    }
}
#endif
