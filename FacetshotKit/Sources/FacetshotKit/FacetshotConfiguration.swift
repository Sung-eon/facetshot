import Foundation

/// What a run is asked to do, read from the environment.
///
/// | Variable | Meaning |
/// |---|---|
/// | `FACETSHOT_OUT` | Absolute output folder. Absent: the run does nothing. |
/// | `FACETSHOT_LIST=1` | Only write `scenes.json`; render nothing. |
/// | `FACETSHOT_SCENES` | Comma-separated id patterns (see ``ScenePattern``). Empty: every scene. |
/// | `FACETSHOT_DEVICES` | JSON array of ``FacetshotDevice``. Absent: ``FacetshotDevice/defaults``. |
/// | `FACETSHOT_VARIANTS` | JSON array of ``FacetshotVariant``. Absent: ``FacetshotVariant/defaults``. |
/// | `FACETSHOT_SETTLE_MS` | Most time to wait for a view to stop changing, per picture (default 1500). |
///
/// `xcodebuild test` passes `TEST_RUNNER_<NAME>` to the test process as `<NAME>`; the prefixed spelling is read as well,
/// for runners that do not strip it.
public struct FacetshotConfiguration: Sendable {
    public var output: URL
    public var listOnly: Bool
    public var patterns: [ScenePattern]
    public var devices: [FacetshotDevice]
    public var variants: [FacetshotVariant]
    public var settle: Duration

    public init(
        output: URL, listOnly: Bool = false, patterns: [ScenePattern] = [], devices: [FacetshotDevice] = FacetshotDevice.defaults,
        variants: [FacetshotVariant] = FacetshotVariant.defaults, settle: Duration = .milliseconds(1500)
    ) {
        self.output = output
        self.listOnly = listOnly
        self.patterns = patterns
        self.devices = devices
        self.variants = variants
        self.settle = settle
    }

    /// `nil` when `FACETSHOT_OUT` is not set: nothing was asked for.
    public init?(environment: [String: String]) throws {
        func value(_ name: String) -> String? {
            let found = environment[name] ?? environment["TEST_RUNNER_" + name]
            return found?.isEmpty == true ? nil : found
        }
        guard let out = value("FACETSHOT_OUT") else { return nil }
        let decoder = JSONDecoder()
        func decoded<T: Decodable>(_ type: T.Type, _ name: String) throws -> T? {
            guard let json = value(name) else { return nil }
            do {
                return try decoder.decode(T.self, from: Data(json.utf8))
            } catch {
                throw FacetshotError.badEnvironment(name, String(describing: error))
            }
        }
        self.init(
            output: URL(filePath: out, directoryHint: .isDirectory),
            listOnly: value("FACETSHOT_LIST").map { $0 != "0" && $0 != "false" } ?? false,
            patterns: (value("FACETSHOT_SCENES") ?? "").split(separator: ",").map { ScenePattern(String($0).trimmingCharacters(in: .whitespaces)) }.filter { !$0.source.isEmpty },
            devices: try decoded([FacetshotDevice].self, "FACETSHOT_DEVICES") ?? FacetshotDevice.defaults,
            variants: try decoded([FacetshotVariant].self, "FACETSHOT_VARIANTS") ?? FacetshotVariant.defaults,
            settle: value("FACETSHOT_SETTLE_MS").flatMap(Int.init).map { .milliseconds($0) } ?? .milliseconds(1500)
        )
    }

    /// Whether `FACETSHOT_SCENES` selects this id.
    public func selects(_ id: String) -> Bool {
        patterns.isEmpty || patterns.contains { $0.matches(id) }
    }
}

/// A pattern over scene ids. With no glob characters it is a plain substring; otherwise `*` matches within one
/// `/`-separated segment, `**` matches across segments, and `?` matches one character other than `/`. Glob patterns match the whole id.
public struct ScenePattern: Sendable, Equatable {
    public let source: String

    public init(_ source: String) { self.source = source }

    public var isGlob: Bool { source.contains { "*?".contains($0) } }

    public func matches(_ id: String) -> Bool {
        guard isGlob else { return id.contains(source) }
        return Self.match(Array(source), 0, Array(id), 0)
    }

    private static func match(_ p: [Character], _ pi: Int, _ s: [Character], _ si: Int) -> Bool {
        if pi == p.count { return si == s.count }
        switch p[pi] {
        case "*":
            if pi + 1 < p.count, p[pi + 1] == "*" {
                // `**` swallows anything, `/` included; `**/` may also stand for no segment at all.
                var next = pi + 2
                if next < p.count, p[next] == "/", match(p, next + 1, s, si) { return true }
                next = pi + 2
                for k in si...s.count where match(p, next, s, k) { return true }
                return false
            }
            var k = si
            while true {
                if match(p, pi + 1, s, k) { return true }
                if k == s.count || s[k] == "/" { return false }
                k += 1
            }
        case "?":
            return si < s.count && s[si] != "/" && match(p, pi + 1, s, si + 1)
        default:
            return si < s.count && s[si] == p[pi] && match(p, pi + 1, s, si + 1)
        }
    }
}

public enum FacetshotError: Error, CustomStringConvertible {
    case badEnvironment(String, String)
    case renderFailed(String)
    case unsupportedPlatform

    public var description: String {
        switch self {
        case let .badEnvironment(name, why): "\(name) could not be read: \(why)"
        case let .renderFailed(why): "render failed: \(why)"
        case .unsupportedPlatform: "facetshot renders on iOS, tvOS, visionOS and macOS only"
        }
    }
}
