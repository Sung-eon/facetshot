import Foundation
import ImageIO
import SwiftUI
import UniformTypeIdentifiers

/// The entry point a test calls.
///
/// ```swift
/// @Test @MainActor func facetshot() async throws {
///     try await Facetshot.run(MyScenes.all)
/// }
/// ```
///
/// With no `FACETSHOT_OUT` in the environment the call returns at once, so an ordinary test run is unaffected.
/// See ``FacetshotConfiguration`` for every variable, and the package README for the output's shape.
@MainActor
public enum Facetshot {
    /// Renders the selected scenes on every device × variant the environment asks for, writing PNGs, `index.json`
    /// (or only `scenes.json` with `FACETSHOT_LIST=1`). Returns what was written; empty when nothing was asked for.
    ///
    /// A scene that throws or fails to draw is recorded with its error and the run goes on; the call itself throws
    /// only when the request cannot be read or the output folder cannot be written.
    @discardableResult
    public static func run(_ scenes: [FacetshotScene], environment: [String: String] = ProcessInfo.processInfo.environment) async throws -> [FacetshotResult] {
        guard let configuration = try FacetshotConfiguration(environment: environment) else { return [] }
        return try await run(scenes, configuration: configuration)
    }

    @discardableResult
    public static func run(_ scenes: [FacetshotScene], configuration: FacetshotConfiguration) async throws -> [FacetshotResult] {
        let files = FileManager.default
        try files.createDirectory(at: configuration.output, withIntermediateDirectories: true)
        var seen = Set<String>()
        for scene in scenes where !seen.insert(scene.id).inserted {
            throw FacetshotError.badEnvironment("scenes", "the id \"\(scene.id)\" is used twice")
        }
        let selected = scenes.filter { configuration.selects($0.id) }

        if configuration.listOnly {
            let list = selected.map { SceneListing(id: $0.id, title: $0.title, tags: $0.tags) }
            try write(list, to: configuration.output.appending(path: "scenes.json"))
            return []
        }

        var results: [FacetshotResult] = []
        let index = configuration.output.appending(path: "index.json")
        for scene in selected {
            let folder = configuration.output.appending(path: scene.folderName, directoryHint: .isDirectory)
            for device in configuration.devices {
                for variant in configuration.variants where scene.applies(to: device, variant) {
                    let started = ContinuousClock.now
                    var result = FacetshotResult(scene: scene.id, device: device.name, variant: variant.name)
                    do {
                        let view = try scene.make()
                        let image = try await FacetshotRenderer.render(view, on: device, in: variant, layout: scene.layout, wait: scene.wait, settle: configuration.settle)
                        try files.createDirectory(at: folder, withIntermediateDirectories: true)
                        let name = "\(device.name).\(variant.name).png"
                        try writePNG(image, to: folder.appending(path: name))
                        result.path = "\(scene.folderName)/\(name)"
                        result.width = image.width
                        result.height = image.height
                    } catch {
                        result.error = String(describing: error)
                    }
                    result.ms = Int((ContinuousClock.now - started) / .milliseconds(1))
                    results.append(result)
                    print("facetshot: \(scene.id) \(device.name).\(variant.name) \(result.error.map { "failed: \($0)" } ?? "\(result.ms) ms")")
                    // Written after every picture, so a crash part-way still leaves what was done.
                    try write(results, to: index)
                }
            }
        }
        try write(results, to: index)
        return results
    }

    private static func write(_ value: some Encodable, to url: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        try encoder.encode(value).write(to: url, options: .atomic)
    }

    static func writePNG(_ image: CGImage, to url: URL) throws {
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            throw FacetshotError.renderFailed("cannot create \(url.path)")
        }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw FacetshotError.renderFailed("cannot write \(url.path)") }
    }
}

/// One line of `index.json`.
public struct FacetshotResult: Encodable, Sendable, Equatable {
    public var scene: String
    public var device: String
    public var variant: String
    /// Relative to the output folder; `nil` when the picture failed.
    public var path: String?
    public var ms = 0
    /// In pixels.
    public var width = 0
    public var height = 0
    public var error: String?

    private enum CodingKeys: String, CodingKey { case scene, device, variant, path, ms, width, height, error }

    /// `path` and `error` are written as `null` rather than left out.
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(scene, forKey: .scene)
        try c.encode(device, forKey: .device)
        try c.encode(variant, forKey: .variant)
        try c.encode(path, forKey: .path)
        try c.encode(ms, forKey: .ms)
        try c.encode(width, forKey: .width)
        try c.encode(height, forKey: .height)
        try c.encode(error, forKey: .error)
    }
}

/// One line of `scenes.json`.
struct SceneListing: Encodable {
    let id: String
    let title: String
    let tags: [String]
}
