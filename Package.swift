// swift-tools-version: 6.0
// FacetshotKit, facetshot's Swift companion: SwiftUI views rendered to PNG inside a test (FacetshotKit/README.md).
// It sits at the repository's root so `.package(url:)` on the facetshot repository finds it.
import PackageDescription

let package = Package(
    name: "facetshot",
    platforms: [.iOS(.v17), .macOS(.v14), .tvOS(.v17), .visionOS(.v1)],
    products: [
        .library(name: "FacetshotKit", targets: ["FacetshotKit"]),
    ],
    targets: [
        .target(name: "FacetshotKit", path: "FacetshotKit/Sources/FacetshotKit"),
        .testTarget(name: "FacetshotKitTests", dependencies: ["FacetshotKit"], path: "FacetshotKit/Tests/FacetshotKitTests"),
    ],
    swiftLanguageModes: [.v6]
)
