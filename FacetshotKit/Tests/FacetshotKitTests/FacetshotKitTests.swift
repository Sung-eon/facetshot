import Foundation
import SwiftUI
import Testing
@testable import FacetshotKit

@Suite struct ScenePatternTests {
    @Test(arguments: [
        ("Book", "Book/Page", true),
        ("Page", "Book/Page", true),
        ("Book/*", "Book/Page", true),
        ("Book/*", "Book/Page/Dark", false),
        ("Book/**", "Book/Page/Dark", true),
        ("**/Card/*", "Weave/Card/answer", true),
        ("**/Card/*", "Card/answer", true),
        ("Weave/*/answer", "Weave/Card/answer", true),
        ("Walk/?arks", "Walk/marks", true),
        ("*", "Book/Page", false),
        ("**", "Book/Page", true),
        ("Table", "Talk/Thread", false),
    ])
    func matches(pattern: String, id: String, expected: Bool) {
        #expect(ScenePattern(pattern).matches(id) == expected)
    }
}

@Suite struct ConfigurationTests {
    @Test func nothingAskedIsNothingDone() throws {
        #expect(try FacetshotConfiguration(environment: [:]) == nil)
        #expect(try FacetshotConfiguration(environment: ["FACETSHOT_OUT": ""]) == nil)
    }

    @Test func readsTheContract() throws {
        let configuration = try #require(try FacetshotConfiguration(environment: [
            "TEST_RUNNER_FACETSHOT_OUT": "/tmp/out",
            "FACETSHOT_LIST": "1",
            "FACETSHOT_SCENES": "Book/*, Weave",
            "FACETSHOT_DEVICES": #"[{"name":"ipad","width":1376,"height":1032,"scale":2,"idiom":"pad","safeArea":{"top":24,"bottom":20,"left":0,"right":0}}]"#,
            "FACETSHOT_VARIANTS": #"[{"name":"large","appearance":"dark","dynamicType":"accessibility1","locale":"ko-KR","layoutDirection":"rightToLeft"}]"#,
        ]))
        #expect(configuration.output.path == "/tmp/out")
        #expect(configuration.listOnly)
        #expect(configuration.selects("Book/Page") && configuration.selects("Weave/Card/x") && !configuration.selects("Talk/Thread"))
        let device = try #require(configuration.devices.first)
        #expect(device.orientation == .landscape && device.horizontalSizeClass == .regular && device.verticalSizeClass == .regular)
        #expect(device.safeArea.top == 24)
        let variant = try #require(configuration.variants.first)
        #expect(variant.appearance == .dark && variant.dynamicType == .accessibility1 && variant.locale == "ko-KR" && variant.layoutDirection == .rightToLeft)
    }

    @Test func sizeClassesFollowTheIdiom() {
        #expect(FacetshotDevice(name: "p", width: 440, height: 956, idiom: .phone).horizontalSizeClass == .compact)
        let sideways = FacetshotDevice(name: "p", width: 956, height: 440, idiom: .phone)
        #expect(sideways.horizontalSizeClass == .regular && sideways.verticalSizeClass == .compact)
        #expect(FacetshotDevice(name: "half", width: 507, height: 1032, idiom: .pad).horizontalSizeClass == .compact)
    }

    @Test func theCLIsSpellingsAreUnderstood() throws {
        let variant = try JSONDecoder().decode(FacetshotVariant.self, from: Data(#"{"name":"rtl","text":"large","direction":"rtl","contrast":"more"}"#.utf8))
        #expect(variant.dynamicType == .accessibility1 && variant.layoutDirection == .rightToLeft && variant.increasedContrast)
    }

    @Test func aBadRequestSaysWhich() {
        #expect(throws: FacetshotError.self) {
            try FacetshotConfiguration(environment: ["FACETSHOT_OUT": "/tmp/x", "FACETSHOT_DEVICES": "[{}]"])
        }
    }
}

@MainActor
@Suite struct RunTests {
    private func folder() -> URL {
        FileManager.default.temporaryDirectory.appending(path: "facetshot-\(UUID().uuidString)", directoryHint: .isDirectory)
    }

    private let device = FacetshotDevice(name: "small", width: 200, height: 120, scale: 2, idiom: .phone)

    @Test func listsWithoutDrawing() async throws {
        let out = folder()
        let scenes = [FacetshotScene("A/One", tags: ["x"]) { Text("one") }, FacetshotScene("B/Two") { Text("two") }]
        try await Facetshot.run(scenes, configuration: .init(output: out, listOnly: true, patterns: [ScenePattern("A/*")]))
        let listed = try JSONSerialization.jsonObject(with: Data(contentsOf: out.appending(path: "scenes.json"))) as? [[String: Any]]
        #expect(listed?.count == 1)
        #expect(listed?.first?["id"] as? String == "A/One" && listed?.first?["title"] as? String == "One")
        #expect(!FileManager.default.fileExists(atPath: out.appending(path: "index.json").path))
    }

    @Test func drawsTheWholeScreenAndKeepsGoingPastAFailure() async throws {
        struct Broken: Error {}
        func broken() throws -> Text { throw Broken() }
        let out = folder()
        let scenes = [
            FacetshotScene("Box/Red") { Color.red.frame(width: 40, height: 40) },
            FacetshotScene("Box/Broken") { try broken() },
            FacetshotScene("Box/Fits", layout: .sizeThatFits) { Color.blue.frame(height: 30) },
        ]
        let results = try await Facetshot.run(scenes, configuration: .init(output: out, devices: [device], variants: FacetshotVariant.defaults))
        #expect(results.count == 6)
        let red = try #require(results.first { $0.scene == "Box/Red" && $0.variant == "dark" })
        #expect(red.path == "Box__Red/small.dark.png" && red.width == 400 && red.height == 240 && red.error == nil)
        #expect(FileManager.default.fileExists(atPath: out.appending(path: "Box__Red/small.dark.png").path))
        let broken = try #require(results.first { $0.scene == "Box/Broken" })
        #expect(broken.path == nil && broken.error != nil)
        let fits = try #require(results.first { $0.scene == "Box/Fits" })
        #expect(fits.width == 400 && fits.height == 60)
        let index = try JSONSerialization.jsonObject(with: Data(contentsOf: out.appending(path: "index.json"))) as? [[String: Any]]
        #expect(index?.count == 6)
        #expect(index?.first { $0["scene"] as? String == "Box/Broken" }?["path"] is NSNull)
    }

    @Test func aSceneCanKeepToSomeDevices() async throws {
        let out = folder()
        let scenes = [FacetshotScene("Only/Mac", devices: ["mac"]) { Text("mac") }]
        let results = try await Facetshot.run(scenes, configuration: .init(output: out, devices: [device]))
        #expect(results.isEmpty)
    }
}
