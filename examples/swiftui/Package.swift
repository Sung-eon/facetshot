// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SwiftUIExample",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "ExampleViews", targets: ["ExampleViews"]),
    ],
    dependencies: [
        // In your own project: .package(url: "https://github.com/facetshot/facetshot", from: "0.1.0") (FacetshotKit).
        .package(path: "../.."),
    ],
    targets: [
        .target(name: "ExampleViews"),
        .testTarget(name: "ExampleTests", dependencies: ["ExampleViews", .product(name: "FacetshotKit", package: "facetshot")]),
    ],
    swiftLanguageModes: [.v6]
)
