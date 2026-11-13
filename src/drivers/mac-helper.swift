// facetshot's helper for Mac app windows (`src/drivers/macos.ts`, `mac-ui.ts`), compiled once with swiftc into
// ~/.facetshot/bin. Every command acts on one process, named by its pid, and on nothing else on the screen.
//
//   check                       `granted` if this process may record the screen (and so screenshot a window)
//   trusted                     `granted` if it may use Accessibility (read and press another app's controls)
//   <pid>                       the process's windows on screen, one per line: `<id> <width> <height> <x> <y>`, largest last
//   tree <pid>                  its main window, open menus and sheets as JSON lines, one per element, depth first
//   do <pid> <path> <action> [role] [name]
//                               an Accessibility action (AXPress, AXShowMenu, AXConfirm, AXIncrement…) on an element,
//                               or `focus`; role and name find it again if the path has moved
//   set <pid> <path> <value> [role] [name]   sets an element's value (a text field's text, a checkbox's state)
//   menubar <pid> <File>Export…>  chooses an item in the app's menu bar
//   click <pid> <x> <y> [left|right] [count]   a real click at a point on the screen (the app comes to the front)
//   move <pid> <x> <y>  ·  drag <pid> <x1> <y1> <x2> <y2>  ·  scroll <pid> <x> <y> <dy>  ·  type <pid> <text>  ·  key <pid> <Shift+Meta+K>
//
// Points are the screen's, in points, from its top left: what Accessibility reports.
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

let arguments = Array(CommandLine.arguments.dropFirst())
func fail(_ message: String, _ code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}
guard let command = arguments.first else { fail("usage: mac-helper check | trusted | <pid> | tree <pid> | do … | set … | menubar … | click … | drag … | scroll … | type … | key …", 2) }

// MARK: Windows

if command == "check" {
    print(CGPreflightScreenCaptureAccess() ? "granted" : "denied")
    exit(0)
}
if command == "trusted" {
    print(AXIsProcessTrusted() ? "granted" : "denied")
    exit(0)
}
if let pid = Int(command), arguments.count == 1 {
    let all = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    let mine = all.filter { ($0[kCGWindowOwnerPID as String] as? Int) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 }
    let sized = mine.compactMap { window -> (id: Int, width: Double, height: Double, x: Double, y: Double)? in
        guard let id = window[kCGWindowNumber as String] as? Int, let bounds = window[kCGWindowBounds as String] as? [String: Double] else { return nil }
        let width = bounds["Width"] ?? 0, height = bounds["Height"] ?? 0
        // Tooltips and drag images are windows too; a window worth a screenshot is at least 200 × 200.
        return width * height > 40_000 ? (id, width, height, bounds["X"] ?? 0, bounds["Y"] ?? 0) : nil
    }
    for window in sized.sorted(by: { $0.width * $0.height < $1.width * $1.height }) {
        print("\(window.id) \(Int(window.width)) \(Int(window.height)) \(Int(window.x)) \(Int(window.y))")
    }
    exit(0)
}

// MARK: Accessibility

guard arguments.count >= 2, let pidValue = Int32(arguments[1]) else { fail("\(command) needs a pid", 2) }
let pid: pid_t = pidValue
guard AXIsProcessTrusted() else {
    fail("facetshot may not use Accessibility, so it can't read or press the app's controls. Allow it in System Settings → Privacy & Security → Accessibility, for the app facetshot runs in.", 3)
}
let app = AXUIElementCreateApplication(pid)
AXUIElementSetMessagingTimeout(app, 5)

func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
    var value: AnyObject?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func children(_ element: AXUIElement) -> [AXUIElement] {
    attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []
}
func string(_ value: AnyObject?) -> String? {
    if let text = value as? String { return text.isEmpty ? nil : text }
    if let number = value as? NSNumber { return number.stringValue }
    return nil
}
func point(_ value: AnyObject?) -> CGPoint? {
    guard let value, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero
    return AXValueGetValue(value as! AXValue, .cgPoint, &point) ? point : nil
}
func size(_ value: AnyObject?) -> CGSize? {
    guard let value, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    var size = CGSize.zero
    return AXValueGetValue(value as! AXValue, .cgSize, &size) ? size : nil
}
/** What a person would call it: its title, its label, or for text, the text. */
func name(_ element: AXUIElement, role: String) -> String {
    for key in [kAXTitleAttribute, kAXDescriptionAttribute, "AXLabel"] {
        if let text = string(attribute(element, key)) { return text }
    }
    if role == kAXStaticTextRole as String, let text = string(attribute(element, kAXValueAttribute)) { return text }
    // A field named only by the hint inside it (SwiftUI's TextField("Name", …)).
    if let hint = string(attribute(element, kAXPlaceholderValueAttribute)) { return hint }
    // A control without a title of its own is often named by the text beside it.
    if let titled = attribute(element, kAXTitleUIElementAttribute), CFGetTypeID(titled) == AXUIElementGetTypeID() {
        if let text = string(attribute(titled as! AXUIElement, kAXValueAttribute)) ?? string(attribute(titled as! AXUIElement, kAXTitleAttribute)) { return text }
    }
    return ""
}
func role(_ element: AXUIElement) -> String { string(attribute(element, kAXRoleAttribute)) ?? "" }

/** The parts of the app a screen is made of: its windows and any menu it has open, not its menu bar. */
func roots() -> [(index: Int, element: AXUIElement)] {
    children(app).enumerated().filter { role($0.element) != kAXMenuBarRole as String }.map { ($0.offset, $0.element) }
}

func resolve(_ path: String, role wanted: String?, name wantedName: String?) -> AXUIElement? {
    var element = app
    for part in path.split(separator: ".") {
        guard let index = Int(part) else { return nil }
        let list = children(element)
        guard index < list.count else { element = app; break }
        element = list[index]
    }
    let matches = { (each: AXUIElement) -> Bool in
        (wanted == nil || role(each) == wanted) && (wantedName == nil || name(each, role: role(each)) == wantedName)
    }
    if element != app, matches(element) { return element }
    guard wanted != nil || wantedName != nil else { return element == app ? nil : element }
    // The path has moved (something appeared above it): look for the same role and name instead.
    var queue = roots().map { $0.element }
    var seen = 0
    while !queue.isEmpty, seen < 5000 {
        let each = queue.removeFirst()
        seen += 1
        if matches(each) { return each }
        queue.append(contentsOf: children(each))
    }
    return nil
}

func json(_ object: [String: Any]) -> String {
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    return String(data: data, encoding: .utf8)!
}

switch command {
case "tree":
    var count = 0
    func walk(_ element: AXUIElement, _ path: String, _ depth: Int) {
        guard count < 4000, depth < 60 else { return }
        count += 1
        let kind = role(element)
        var line: [String: Any] = ["path": path, "depth": depth, "role": kind, "name": name(element, role: kind)]
        if let subrole = string(attribute(element, kAXSubroleAttribute)) { line["subrole"] = subrole }
        if kind != kAXStaticTextRole as String, let value = string(attribute(element, kAXValueAttribute)) { line["value"] = String(value.prefix(200)) }
        if let at = point(attribute(element, kAXPositionAttribute)), let extent = size(attribute(element, kAXSizeAttribute)) {
            line["x"] = Double(at.x); line["y"] = Double(at.y); line["width"] = Double(extent.width); line["height"] = Double(extent.height)
        }
        if let enabled = attribute(element, kAXEnabledAttribute) as? Bool, !enabled { line["disabled"] = true }
        if let focused = attribute(element, kAXFocusedAttribute) as? Bool, focused { line["focused"] = true }
        if let selected = attribute(element, kAXSelectedAttribute) as? Bool, selected { line["selected"] = true }
        if let expanded = attribute(element, kAXExpandedAttribute) as? Bool, expanded { line["expanded"] = true }
        var names: CFArray?
        if AXUIElementCopyActionNames(element, &names) == .success, let actions = names as? [String], !actions.isEmpty { line["actions"] = actions }
        print(json(line))
        for (index, child) in children(element).enumerated() { walk(child, "\(path).\(index)", depth + 1) }
    }
    for (index, root) in roots() { walk(root, "\(index)", 0) }

case "do":
    guard arguments.count >= 4 else { fail("do <pid> <path> <action> [role] [name]", 2) }
    guard let element = resolve(arguments[2], role: arguments.count > 4 ? arguments[4] : nil, name: arguments.count > 5 ? arguments[5] : nil) else { fail("That element isn't there any more.") }
    let action = arguments[3]
    let result = action == "focus"
        ? AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        : AXUIElementPerformAction(element, action as CFString)
    if result != .success { fail("\(action) didn't work on it (\(result.rawValue)).") }

case "set":
    guard arguments.count >= 4 else { fail("set <pid> <path> <value> [role] [name]", 2) }
    guard let element = resolve(arguments[2], role: arguments.count > 4 ? arguments[4] : nil, name: arguments.count > 5 ? arguments[5] : nil) else { fail("That element isn't there any more.") }
    _ = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    let current = attribute(element, kAXValueAttribute)
    let value: CFTypeRef = current is NSNumber ? NSNumber(value: Int(arguments[3]) ?? 0) : arguments[3] as CFString
    let result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value)
    if result != .success { fail("Its value can't be set (\(result.rawValue)).") }

case "menubar":
    guard arguments.count >= 3 else { fail("menubar <pid> <File>Export…>", 2) }
    let tidy = { (text: String) -> String in
        text.replacingOccurrences(of: "&", with: "").replacingOccurrences(of: "…", with: "").replacingOccurrences(of: "...", with: "").trimmingCharacters(in: .whitespaces).lowercased()
    }
    let labels = arguments[2].split(separator: ">").map { String($0).trimmingCharacters(in: .whitespaces) }
    guard let bar = attribute(app, kAXMenuBarAttribute), CFGetTypeID(bar) == AXUIElementGetTypeID() else { fail("The app has no menu bar.") }
    var items = children(bar as! AXUIElement)
    for (index, label) in labels.enumerated() {
        guard let item = items.first(where: { tidy(name($0, role: role($0))) == tidy(label) }) else {
            fail("No menu item \"\(label)\"; there are: \(items.map { name($0, role: role($0)) }.filter { !$0.isEmpty }.joined(separator: ", ")).")
        }
        if index == labels.count - 1 {
            if let enabled = attribute(item, kAXEnabledAttribute) as? Bool, !enabled { fail("\"\(label)\" is disabled.") }
            let result = AXUIElementPerformAction(item, kAXPressAction as CFString)
            if result != .success { fail("\"\(label)\" didn't respond (\(result.rawValue)).") }
        } else {
            // A menu's items are the children of its one AXMenu child.
            items = children(item).flatMap { role($0) == kAXMenuRole as String ? children($0) : [$0] }
        }
    }

default:
    // Real input: the app has to be in front for the events to reach it.
    NSRunningApplication(processIdentifier: pid)?.activate()
    usleep(150_000)
    let number = { (index: Int) -> CGFloat in
        guard index < arguments.count, let value = Double(arguments[index]) else { fail("\(command) needs a number at argument \(index)", 2) }
        return CGFloat(value)
    }
    func post(_ type: CGEventType, _ at: CGPoint, _ button: CGMouseButton = .left, clicks: Int64 = 1) {
        let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: at, mouseButton: button)!
        event.setIntegerValueField(.mouseEventClickState, value: clicks)
        event.post(tap: .cghidEventTap)
        usleep(15_000)
    }
    switch command {
    case "click":
        let at = CGPoint(x: number(2), y: number(3))
        let right = arguments.count > 4 && arguments[4] == "right"
        let count = arguments.count > 5 ? Int64(arguments[5]) ?? 1 : 1
        post(.mouseMoved, at)
        for click in 1...count {
            post(right ? .rightMouseDown : .leftMouseDown, at, right ? .right : .left, clicks: click)
            post(right ? .rightMouseUp : .leftMouseUp, at, right ? .right : .left, clicks: click)
        }
    case "move":
        post(.mouseMoved, CGPoint(x: number(2), y: number(3)))
    case "drag":
        let from = CGPoint(x: number(2), y: number(3)), to = CGPoint(x: number(4), y: number(5))
        post(.mouseMoved, from)
        post(.leftMouseDown, from)
        for step in 1...12 {
            let t = CGFloat(step) / 12
            post(.leftMouseDragged, CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t))
        }
        post(.leftMouseUp, to)
    case "scroll":
        post(.mouseMoved, CGPoint(x: number(2), y: number(3)))
        let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: Int32(-number(4)), wheel2: 0, wheel3: 0)!
        event.post(tap: .cghidEventTap)
    case "type":
        guard arguments.count >= 3 else { fail("type <pid> <text>", 2) }
        for character in arguments[2] {
            let units = Array(String(character).utf16)
            for down in [true, false] {
                let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)!
                event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
                event.postToPid(pid)
            }
            usleep(4_000)
        }
    case "key":
        guard arguments.count >= 3 else { fail("key <pid> <Shift+Meta+K>", 2) }
        let codes: [String: CGKeyCode] = [
            "enter": 36, "return": 36, "tab": 48, "space": 49, "backspace": 51, "delete": 117, "escape": 53, "esc": 53,
            "arrowleft": 123, "arrowright": 124, "arrowdown": 125, "arrowup": 126, "home": 115, "end": 119,
            "pageup": 116, "pagedown": 121,
            "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13,
            "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25,
            "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38,
            "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "`": 50
        ]
        var flags: CGEventFlags = []
        var key: CGKeyCode?
        for part in arguments[2].split(separator: "+").map({ $0.lowercased() }) {
            switch part {
            case "shift": flags.insert(.maskShift)
            case "meta", "cmd", "command", "controlormeta": flags.insert(.maskCommand)
            case "control", "ctrl": flags.insert(.maskControl)
            case "alt", "option": flags.insert(.maskAlternate)
            default:
                guard let code = codes[part] else { fail("\"\(part)\" isn't a key facetshot knows on a Mac.") }
                key = code
            }
        }
        guard let key else { fail("\(arguments[2]) names no key.") }
        for down in [true, false] {
            let event = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: down)!
            event.flags = flags
            event.postToPid(pid)
        }
    default:
        fail("\(command) isn't a command.", 2)
    }
}
