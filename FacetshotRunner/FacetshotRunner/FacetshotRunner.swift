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
///     tree                          what's on screen, into `<n>.data`: one JSON line per element, depth first
///     press <x> <y>                 a tap at a point on the app, in points from its top left
///     longpress <x> <y>             a press held for a second (a context menu)
///     drag <x1> <y1> <x2> <y2>      press, hold, and move to the second point
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
                if let data = try run(words, on: app) {
                    try Data(data.utf8).write(to: folder.appending(path: "\(next).data"))
                }
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

    /// A point on the app, in points from its top left.
    @MainActor
    private func point(_ words: [String], _ at: Int, in app: XCUIApplication) throws -> XCUICoordinate {
        guard words.count > at + 1, let x = Double(words[at]), let y = Double(words[at + 1]) else {
            throw Failure(description: "\(words.first ?? "") needs a point: x y")
        }
        return app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: y))
    }

    /// Element types as the web names their roles, so `role=button[name="Save"]` means the same thing everywhere.
    private func role(_ type: XCUIElement.ElementType) -> String {
        switch type {
        case .button: return "button"
        case .link: return "link"
        case .textField, .secureTextField, .textView: return "textbox"
        case .searchField: return "searchbox"
        case .switch, .toggle: return "switch"
        case .slider: return "slider"
        case .staticText: return "text"
        case .image: return "img"
        case .cell: return "cell"
        case .menuItem: return "menuitem"
        case .menu: return "menu"
        case .tab: return "tab"
        case .tabBar: return "tablist"
        case .navigationBar: return "navigation"
        case .segmentedControl: return "radiogroup"
        case .picker, .pickerWheel: return "combobox"
        case .alert: return "alertdialog"
        case .sheet: return "dialog"
        case .window: return "window"
        case .application: return "application"
        default: return "generic"
        }
    }

    /// Returns data for `<n>.data`, when the command has some.
    @MainActor
    private func run(_ words: [String], on app: XCUIApplication) throws -> String? {
        let verb = words.first ?? ""
        let argument = words.dropFirst().first ?? ""
        switch verb {
        case "tree":
            let snapshot = try app.snapshot()
            let origin = snapshot.frame.origin
            var lines: [String] = []
            func walk(_ node: XCUIElementSnapshot, _ path: String, _ depth: Int) {
                guard lines.count < 3000 else { return }
                var line: [String: Any] = [
                    "path": path, "depth": depth, "role": role(node.elementType),
                    "name": node.label.isEmpty ? node.identifier : node.label,
                    "x": node.frame.minX - origin.x, "y": node.frame.minY - origin.y,
                    "width": node.frame.width, "height": node.frame.height
                ]
                if let value = node.value as? String, !value.isEmpty { line["value"] = String(value.prefix(200)) }
                if let value = node.value as? NSNumber { line["value"] = value.stringValue }
                if !node.isEnabled { line["disabled"] = true }
                if node.isSelected { line["selected"] = true }
                if node.hasFocus { line["focused"] = true }
                if let data = try? JSONSerialization.data(withJSONObject: line, options: [.sortedKeys]) {
                    lines.append(String(decoding: data, as: UTF8.self))
                }
                for (index, child) in node.children.enumerated() { walk(child, "\(path).\(index)", depth + 1) }
            }
            walk(snapshot, "0", 0)
            return lines.joined(separator: "\n") + "\n"
        case "press":
            try point(words, 1, in: app).tap()
        case "longpress":
            try point(words, 1, in: app).press(forDuration: 1.0)
        case "drag":
            try point(words, 1, in: app).press(forDuration: 0.5, thenDragTo: try point(words, 3, in: app))
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
        return nil
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
