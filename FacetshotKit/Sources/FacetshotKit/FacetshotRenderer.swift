import CoreGraphics
import Foundation
import SwiftUI

/// Hosts a view in a real window at the device's size, lets it settle, and takes its picture.
///
/// The platform halves (`FacetshotRenderer+UIKit.swift`, `FacetshotRenderer+AppKit.swift`) build the window; what they share —
/// the SwiftUI environment and the wait for a still frame — is here.
@MainActor
enum FacetshotRenderer {
    /// The SwiftUI half of a variant and device: what SwiftUI reads from the environment. The platform half sets the same
    /// things as UIKit/AppKit traits, so views backed by UIKit/AppKit (lists, text fields, sheets) agree.
    static func dressed(_ view: AnyView, on device: FacetshotDevice, in variant: FacetshotVariant) -> some View {
        view
            .environment(\.colorScheme, variant.appearance == .dark ? .dark : .light)
            .environment(\.dynamicTypeSize, variant.dynamicType ?? .large)
            .environment(\.layoutDirection, variant.layoutDirection)
            .environment(\.locale, variant.locale.map(Locale.init(identifier:)) ?? Locale(identifier: "en_US"))
            .environment(\.horizontalSizeClass, device.horizontalSizeClass == .compact ? .compact : .regular)
            .environment(\.verticalSizeClass, device.verticalSizeClass == .compact ? .compact : .regular)
    }

    /// Takes pictures until two in a row are the same (the view has finished laying out, loading and animating), or
    /// until `settle` has passed, whichever is first; the last picture is the one kept. Nothing is compared before `wait`.
    ///
    /// Waiting is `Task.sleep` on the main actor, which lets the main run loop turn: layout passes, `.task` and
    /// `onAppear` work, Core Animation commits and presentations all happen in between.
    static func settled(after wait: Duration, within settle: Duration, picture: () throws -> CGImage) async throws -> CGImage {
        let clock = ContinuousClock()
        let deadline = clock.now + wait + settle
        try await Task.sleep(for: max(wait, .milliseconds(16)))
        var last = try picture()
        var lastBytes = bytes(of: last)
        while clock.now < deadline {
            try await Task.sleep(for: .milliseconds(60))
            let next = try picture()
            let nextBytes = bytes(of: next)
            if nextBytes != nil, nextBytes == lastBytes { return next }
            last = next
            lastBytes = nextBytes
        }
        return last
    }

    private static func bytes(of image: CGImage) -> Data? {
        image.dataProvider?.data as Data?
    }

    /// The size in points a scene is drawn at.
    static func size(for layout: FacetshotLayout, on device: FacetshotDevice, fitting: (CGSize) -> CGSize) -> CGSize {
        switch layout {
        case .device:
            CGSize(width: device.width, height: device.height)
        case let .fixed(width, height):
            CGSize(width: width, height: height)
        case .sizeThatFits:
            CGSize(width: device.width, height: max(1, fitting(CGSize(width: device.width, height: .greatestFiniteMagnitude)).height.rounded(.up)))
        }
    }

    #if !os(iOS) && !os(tvOS) && !os(visionOS) && !os(macOS)
    static func render(_ view: AnyView, on device: FacetshotDevice, in variant: FacetshotVariant, layout: FacetshotLayout, wait: Duration, settle: Duration) async throws -> CGImage {
        throw FacetshotError.unsupportedPlatform
    }
    #endif
}
