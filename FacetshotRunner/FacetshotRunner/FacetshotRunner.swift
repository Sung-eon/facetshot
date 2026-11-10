import Foundation
import XCTest

/// What `simctl` cannot do to a simulator — turn it, press, type — done from a UI test that stays running and takes
/// one command at a time from facetshot (`src/drivers/ios.ts`).
///
/// facetshot starts it with `xcodebuild test-without-building` once per simulator and writes numbered files into the
/// folder `FACETSHOT_RUNNER_DIR` names: `1.cmd`, `2.cmd`, … Each holds one line, its words separated by tabs. The
/// runner answers each with `<n>.out`: `ok`, or `error<TAB>why`. `started` is written once it is listening.
///
///     launch <json>                 (re)launch the app with {"env": {…}, "args": […]}
///     activate                      bring the app to the front
///     open <url>                    open a deep link in the app, without the system's "Open in …?" question that
///                                   `simctl openurl` stops at
///     orient portrait|landscape     turn the device
///     tap <label>                   press the first element with this accessibility label or identifier
///     type <text>                   type into whatever has the keyboard
///     fill <label> <text>           press the element, then type
///     wait <label> <seconds>        until the element exists
///     gone <label> <seconds>        until it no longer exists
///     swipe up|down|left|right      one swipe on the app
///     quit                          end the test
///
/// The app is launched from here (`launch`), not with `simctl`: an app XCUITest launched itself always has its
/// accessibility loaded, while one it only attaches to may not, and then every later command fails. The app is found by
/// its bundle identifier, `FACETSHOT_BUNDLE_ID`.
final class FacetshotRunner: XCTestCase {
    @MainActor
    func testServe() throws {
        continueAfterFailure = true
        executionTimeAllowance = 4 * 3600
        let environment = ProcessInfo.processInfo.environment
        let folder = URL(filePath: try XCTUnwrap(environment["FACETSHOT_RUNNER_DIR"], "FACETSHOT_RUNNER_DIR is not set"))
        let app = XCUIApplication(bundleIdentifier: try XCTUnwrap(environment["FACETSHOT_BUNDLE_ID"], "FACETSHOT_BUNDLE_ID is not set"))
        try Data("started\n".utf8).write(to: folder.appending(path: "started"))

        var next = 1
        var idleSince = Date()
        while true {
            let command = folder.appending(path: "\(next).cmd")
            guard let line = try? String(contentsOf: command, encoding: .utf8) else {
                // Nobody has asked anything for ten minutes: facetshot is gone. Don't hold the simulator forever.
                if Date().timeIntervalSince(idleSince) > 600 { return }
                Thread.sleep(forTimeInterval: 0.05)
                continue
            }
            let words = line.trimmingCharacters(in: .newlines).components(separatedBy: "\t")
            if words.first == "quit" {
                try? Data("ok\n".utf8).write(to: folder.appending(path: "\(next).out"))
                return
            }
            let answer: String
            do {
                try run(words, on: app)
                answer = "ok"
            } catch {
                answer = "error\t\(error)"
            }
            try? Data("\(answer)\n".utf8).write(to: folder.appending(path: "\(next).out"))
            next += 1
            idleSince = Date()
        }
    }

    struct Failure: Error, CustomStringConvertible {
        let description: String
    }

    @MainActor
    private func run(_ words: [String], on app: XCUIApplication) throws {
        let verb = words.first ?? ""
        let argument = words.dropFirst().first ?? ""
        switch verb {
        case "launch":
            struct Launch: Decodable {
                var env: [String: String]
                var args: [String]
            }
            let launch = try JSONDecoder().decode(Launch.self, from: Data(argument.utf8))
            app.launchEnvironment = launch.env
            app.launchArguments = launch.args
            app.launch()
        case "activate":
            app.activate()
        case "open":
            guard let url = URL(string: argument) else { throw Failure(description: "not a URL: \(argument)") }
            app.open(url)
        case "orient":
            XCUIDevice.shared.orientation = argument == "landscape" ? .landscapeLeft : .portrait
        case "tap":
            try find(argument, in: app, within: 10).tap()
        case "type":
            app.typeText(argument)
        case "fill":
            let field = try find(argument, in: app, within: 10)
            field.tap()
            app.typeText(words.dropFirst(2).first ?? "")
        case "wait":
            _ = try find(argument, in: app, within: Double(words.dropFirst(2).first ?? "") ?? 15)
        case "gone":
            let element = element(argument, in: app)
            let deadline = Date().addingTimeInterval(Double(words.dropFirst(2).first ?? "") ?? 15)
            while element.exists {
                if Date() > deadline { throw Failure(description: "\"\(argument)\" is still there") }
                Thread.sleep(forTimeInterval: 0.1)
            }
        case "swipe":
            switch argument {
            case "up": app.swipeUp()
            case "down": app.swipeDown()
            case "left": app.swipeLeft()
            default: app.swipeRight()
            }
        default:
            throw Failure(description: "unknown command \(verb)")
        }
    }

    @MainActor
    private func element(_ label: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@ OR identifier == %@ OR placeholderValue == %@", label, label, label))
            .firstMatch
    }

    @MainActor
    private func find(_ label: String, in app: XCUIApplication, within seconds: Double) throws -> XCUIElement {
        let found = element(label, in: app)
        guard found.waitForExistence(timeout: seconds) else {
            throw Failure(description: "nothing labelled \"\(label)\" within \(Int(seconds)) s")
        }
        return found
    }
}
