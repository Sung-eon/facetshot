import SwiftUI

/// A screen or window a scene is drawn on. Decoded from `FACETSHOT_DEVICES`; unknown keys are ignored.
public struct FacetshotDevice: Codable, Sendable, Equatable {
    public enum Idiom: String, Codable, Sendable { case phone, pad, mac }
    public enum Orientation: String, Codable, Sendable { case portrait, landscape }
    public enum SizeClass: String, Codable, Sendable { case compact, regular }

    public struct Insets: Codable, Sendable, Equatable {
        public var top: Double, bottom: Double, left: Double, right: Double
        public init(top: Double = 0, bottom: Double = 0, left: Double = 0, right: Double = 0) {
            self.top = top; self.bottom = bottom; self.left = left; self.right = right
        }
        public static let zero = Insets()
    }

    public var name: String
    /// Size in points, in the given orientation.
    public var width: Double
    public var height: Double
    public var scale: Double
    public var idiom: Idiom
    public var orientation: Orientation
    public var horizontalSizeClass: SizeClass
    public var verticalSizeClass: SizeClass
    public var safeArea: Insets

    public init(
        name: String, width: Double, height: Double, scale: Double = 2, idiom: Idiom = .phone,
        orientation: Orientation? = nil, horizontalSizeClass: SizeClass? = nil, verticalSizeClass: SizeClass? = nil,
        safeArea: Insets = .zero
    ) {
        self.name = name
        self.width = width
        self.height = height
        self.scale = scale
        self.idiom = idiom
        let orientation = orientation ?? (width > height ? .landscape : .portrait)
        self.orientation = orientation
        let classes = Self.defaultSizeClasses(idiom: idiom, orientation: orientation, width: width)
        self.horizontalSizeClass = horizontalSizeClass ?? classes.horizontal
        self.verticalSizeClass = verticalSizeClass ?? classes.vertical
        self.safeArea = safeArea
    }

    /// What iOS itself would say: a phone is compact across (regular only for a big phone on its side) and compact
    /// up-and-down on its side; an iPad is regular both ways unless it is a narrow slice (under 600 pt, as in Split View); a Mac is regular.
    public static func defaultSizeClasses(idiom: Idiom, orientation: Orientation, width: Double) -> (horizontal: SizeClass, vertical: SizeClass) {
        switch idiom {
        case .phone:
            orientation == .portrait ? (.compact, .regular) : (width >= 900 ? .regular : .compact, .compact)
        case .pad:
            (width < 600 ? .compact : .regular, .regular)
        case .mac:
            (.regular, .regular)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case name, width, height, scale, idiom, orientation, horizontalSizeClass, verticalSizeClass, safeArea
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            name: try c.decode(String.self, forKey: .name),
            width: try c.decode(Double.self, forKey: .width),
            height: try c.decode(Double.self, forKey: .height),
            scale: try c.decodeIfPresent(Double.self, forKey: .scale) ?? 2,
            idiom: try c.decodeIfPresent(Idiom.self, forKey: .idiom) ?? .phone,
            orientation: try c.decodeIfPresent(Orientation.self, forKey: .orientation),
            horizontalSizeClass: try c.decodeIfPresent(SizeClass.self, forKey: .horizontalSizeClass),
            verticalSizeClass: try c.decodeIfPresent(SizeClass.self, forKey: .verticalSizeClass),
            safeArea: try c.decodeIfPresent(Insets.self, forKey: .safeArea) ?? .zero
        )
    }

    /// Used when `FACETSHOT_DEVICES` is not set: a large iPhone on iOS, a laptop-sized window on macOS.
    public static var defaults: [FacetshotDevice] {
        #if os(macOS)
        [FacetshotDevice(name: "mac", width: 1280, height: 800, scale: 2, idiom: .mac)]
        #else
        [FacetshotDevice(name: "iphone", width: 440, height: 956, scale: 3, idiom: .phone, safeArea: .init(top: 62, bottom: 34))]
        #endif
    }
}

/// How a scene is drawn: appearance, text size, locale and direction. Decoded from `FACETSHOT_VARIANTS`.
///
/// Besides the contract's own keys (`appearance`, `dynamicType`, `locale`, `layoutDirection`), the facetshot CLI's variant
/// spellings are understood too: `text` (`default`, `large`, `xlarge`, `xxl`), `direction` (`ltr`, `rtl`) and `contrast` (`more`).
public struct FacetshotVariant: Codable, Sendable, Equatable {
    public enum Appearance: String, Codable, Sendable { case light, dark }

    public var name: String
    public var appearance: Appearance
    public var dynamicType: DynamicTypeSize?
    public var locale: String?
    public var layoutDirection: LayoutDirection
    /// Increased contrast (UIKit's `accessibilityContrast`; ignored on macOS).
    public var increasedContrast: Bool

    public init(
        name: String, appearance: Appearance = .light, dynamicType: DynamicTypeSize? = nil, locale: String? = nil,
        layoutDirection: LayoutDirection = .leftToRight, increasedContrast: Bool = false
    ) {
        self.name = name
        self.appearance = appearance
        self.dynamicType = dynamicType
        self.locale = locale
        self.layoutDirection = layoutDirection
        self.increasedContrast = increasedContrast
    }

    private enum CodingKeys: String, CodingKey { case name, appearance, dynamicType, locale, layoutDirection, text, direction, contrast }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        var dynamicType: DynamicTypeSize?
        if let raw = try c.decodeIfPresent(String.self, forKey: .dynamicType) {
            guard let size = Self.dynamicTypeSizes[raw] else {
                throw DecodingError.dataCorruptedError(forKey: .dynamicType, in: c, debugDescription: "Unknown dynamicType \"\(raw)\"; expected one of \(Self.dynamicTypeSizes.keys.sorted())")
            }
            dynamicType = size
        } else if let text = try c.decodeIfPresent(String.self, forKey: .text) {
            dynamicType = Self.textSizes[text]
        }
        let directionWord = try c.decodeIfPresent(String.self, forKey: .layoutDirection) ?? c.decodeIfPresent(String.self, forKey: .direction)
        self.init(
            name: try c.decode(String.self, forKey: .name),
            appearance: try c.decodeIfPresent(Appearance.self, forKey: .appearance) ?? .light,
            dynamicType: dynamicType,
            locale: try c.decodeIfPresent(String.self, forKey: .locale),
            layoutDirection: ["rightToLeft", "rtl"].contains(directionWord ?? "") ? .rightToLeft : .leftToRight,
            increasedContrast: try c.decodeIfPresent(String.self, forKey: .contrast) == "more"
        )
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(appearance, forKey: .appearance)
        try c.encodeIfPresent(dynamicType.flatMap { size in Self.dynamicTypeSizes.first { $0.value == size }?.key }, forKey: .dynamicType)
        try c.encodeIfPresent(locale, forKey: .locale)
        try c.encode(layoutDirection == .rightToLeft ? "rightToLeft" : "leftToRight", forKey: .layoutDirection)
        if increasedContrast { try c.encode("more", forKey: .contrast) }
    }

    /// SwiftUI's `DynamicTypeSize` cases by name.
    public static let dynamicTypeSizes: [String: DynamicTypeSize] = [
        "xSmall": .xSmall, "small": .small, "medium": .medium, "large": .large, "xLarge": .xLarge, "xxLarge": .xxLarge,
        "xxxLarge": .xxxLarge, "accessibility1": .accessibility1, "accessibility2": .accessibility2,
        "accessibility3": .accessibility3, "accessibility4": .accessibility4, "accessibility5": .accessibility5,
    ]

    /// The CLI's coarse text sizes.
    static let textSizes: [String: DynamicTypeSize] = [
        "default": .large, "large": .accessibility1, "xlarge": .accessibility3, "xxl": .accessibility5,
    ]

    /// Used when `FACETSHOT_VARIANTS` is not set.
    public static let defaults = [FacetshotVariant(name: "light"), FacetshotVariant(name: "dark", appearance: .dark)]
}
