// facetshot's helper for Mac app windows (`src/drivers/macos.ts`, `mac-ui.ts`), compiled once with swiftc into
// ~/.facetshot/bin. Every command acts on one process, named by its pid, and on nothing else on the screen.
//
//   check                       `granted` if this process may record the screen (and so screenshot a window)
//   trusted                     `granted` if it may use Accessibility (read and press another app's controls)
//   <pid>                       the process's windows on screen, one per line: `<id> <width> <height> <x> <y>`, largest last
//   raise <pid>                 brings the app to the front and makes its largest window main and key; prints
//                               `front` or `behind` (needs Accessibility for the window part, not for the app part)
//   tree <pid>                  its main window, open menus and sheets as JSON lines, one per element, depth first;
//                               bounded in depth, count and time, and a last `{"note": …}` line says what was left out
//   do <pid> <path> <action> [role] [name]
//                               an Accessibility action (AXPress, AXShowMenu, AXConfirm, AXIncrement…) on an element,
//                               or `focus`; role and name find it again if the path has moved
//   set <pid> <path> <value> [role] [name]   sets an element's value (a text field's text, a checkbox's state)
//   menubar <pid> <File>Export…>  chooses an item in the app's menu bar
//   click <pid> <x> <y> [left|right] [count]   a real click at a point on the screen (the app comes to the front)
//   move <pid> <x> <y>  ·  drag <pid> <x1> <y1> <x2> <y2>  ·  scroll <pid> <x> <y> <dy>  ·  type <pid> <text>
//   key <pid> <code> <modifiers> <character>
//                               a key press: its virtual key code, modifiers as `command,shift,alt,control` (or empty),
//                               and the character it types (or empty). A shortcut with Command that the app's menu bar
//                               lists chooses that menu item; anything else is a real key press sent to the key window
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
guard let command = arguments.first else { fail("usage: mac-helper check | trusted | <pid> | raise <pid> | tree <pid> | do … | set … | menubar … | click … | drag … | scroll … | type … | key …", 2) }

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
//
// Another app's elements answer whatever they like: an attribute can fail, time out, or hold a type nobody expects
// (a custom view's children array with something other than elements in it). Every read below checks the type it
// gets and treats anything else as missing, so one odd element never stops the helper.

guard arguments.count >= 2, let pidValue = Int32(arguments[1]) else { fail("\(command) needs a pid", 2) }
let pid: pid_t = pidValue

func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
    var value: AnyObject?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func isElement(_ value: AnyObject?) -> Bool {
    guard let value else { return false }
    return CFGetTypeID(value) == AXUIElementGetTypeID()
}
/** The elements in a CF array, skipping anything that isn't one (never a cast that can trap on a stray value). */
func elements(in value: AnyObject?) -> [AXUIElement] {
    guard let value, CFGetTypeID(value) == CFArrayGetTypeID() else { return [] }
    let array = value as! CFArray
    var out: [AXUIElement] = []
    for index in 0..<CFArrayGetCount(array) {
        guard let raw = CFArrayGetValueAtIndex(array, index) else { continue }
        let item = Unmanaged<AnyObject>.fromOpaque(raw).takeUnretainedValue()
        if CFGetTypeID(item) == AXUIElementGetTypeID() { out.append(item as! AXUIElement) }
    }
    return out
}
/** The strings in a CF array, skipping anything else. */
func strings(in value: AnyObject?) -> [String] {
    guard let value, CFGetTypeID(value) == CFArrayGetTypeID() else { return [] }
    let array = value as! CFArray
    var out: [String] = []
    for index in 0..<CFArrayGetCount(array) {
        guard let raw = CFArrayGetValueAtIndex(array, index) else { continue }
        let item = Unmanaged<AnyObject>.fromOpaque(raw).takeUnretainedValue()
        if CFGetTypeID(item) == CFStringGetTypeID() { out.append(item as! String) }
    }
    return out
}
/** An element's children, at most `limit` of them, and how many it says it has. */
func children(_ element: AXUIElement, limit: Int) -> (list: [AXUIElement], total: Int) {
    var count: CFIndex = 0
    if AXUIElementGetAttributeValueCount(element, kAXChildrenAttribute as CFString, &count) == .success, count > limit {
        var values: CFArray?
        guard AXUIElementCopyAttributeValues(element, kAXChildrenAttribute as CFString, 0, limit, &values) == .success else { return ([], count) }
        return (elements(in: values), count)
    }
    let list = elements(in: attribute(element, kAXChildrenAttribute))
    return (list, list.count)
}
func children(_ element: AXUIElement) -> [AXUIElement] { children(element, limit: 100_000).list }
func flag(_ element: AXUIElement, _ name: String) -> Bool? {
    guard let value = attribute(element, name), CFGetTypeID(value) == CFBooleanGetTypeID() else { return nil }
    return CFBooleanGetValue((value as! CFBoolean))
}
func string(_ value: AnyObject?) -> String? {
    guard let value else { return nil }
    if CFGetTypeID(value) == CFStringGetTypeID() {
        let text = value as! String
        return text.isEmpty ? nil : text
    }
    if CFGetTypeID(value) == CFNumberGetTypeID() || CFGetTypeID(value) == CFBooleanGetTypeID() {
        let number = value as! NSNumber
        return number.doubleValue.isFinite ? number.stringValue : nil
    }
    return nil
}
func point(_ value: AnyObject?) -> CGPoint? {
    guard let value, CFGetTypeID(value) == AXValueGetTypeID(), AXValueGetType(value as! AXValue) == .cgPoint else { return nil }
    var point = CGPoint.zero
    return AXValueGetValue(value as! AXValue, .cgPoint, &point) && point.x.isFinite && point.y.isFinite ? point : nil
}
func size(_ value: AnyObject?) -> CGSize? {
    guard let value, CFGetTypeID(value) == AXValueGetTypeID(), AXValueGetType(value as! AXValue) == .cgSize else { return nil }
    var size = CGSize.zero
    return AXValueGetValue(value as! AXValue, .cgSize, &size) && size.width.isFinite && size.height.isFinite ? size : nil
}

/** The app's largest window, the one a screenshot is of. */
func mainWindow(_ app: AXUIElement) -> AXUIElement? {
    elements(in: attribute(app, kAXWindowsAttribute)).max { first, second in
        let a = size(attribute(first, kAXSizeAttribute)) ?? .zero, b = size(attribute(second, kAXSizeAttribute)) ?? .zero
        return a.width * a.height < b.width * b.height
    }
}

/**
 * Brings the app to the front and makes its largest window main and key, so focus-dependent drawing is active and
 * keys reach it. Left alone when that is already so: raising a window again can close a menu it has open.
 */
func bringToFront(_ pid: pid_t) -> Bool {
    let front = { NSWorkspace.shared.frontmostApplication?.processIdentifier == pid }
    if AXIsProcessTrusted() {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 2)
        let window = mainWindow(app)
        let ready = front() && (window.map { flag($0, kAXMainAttribute) == true } ?? true)
        if !ready {
            // Accessibility's frontmost works from a background process where activate() is often refused.
            _ = AXUIElementSetAttributeValue(app, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
            if let window {
                _ = AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, kCFBooleanTrue)
                _ = AXUIElementSetAttributeValue(window, kAXFocusedAttribute as CFString, kCFBooleanTrue)
                _ = AXUIElementPerformAction(window, kAXRaiseAction as CFString)
            }
        }
    }
    if !front() { NSRunningApplication(processIdentifier: pid)?.activate(options: [.activateAllWindows]) }
    var waited = 0
    while !front() && waited < 30 {
        usleep(50_000)
        waited += 1
    }
    return front()
}

if command == "raise" {
    print(bringToFront(pid) ? "front" : "behind")
    exit(0)
}

guard AXIsProcessTrusted() else {
    fail("facetshot may not use Accessibility, so it can't read or press the app's controls. Allow it in System Settings → Privacy & Security → Accessibility, for the app facetshot runs in.", 3)
}
let app = AXUIElementCreateApplication(pid)
AXUIElementSetMessagingTimeout(app, 5)

/** What a person would call it: its title, its label, or for text, the text. */
func name(_ element: AXUIElement, role: String) -> String {
    for key in [kAXTitleAttribute, kAXDescriptionAttribute, "AXLabel"] {
        if let text = string(attribute(element, key)) { return text }
    }
    if role == kAXStaticTextRole as String, let text = string(attribute(element, kAXValueAttribute)) { return text }
    // A field named only by the hint inside it (SwiftUI's TextField("Name", …)).
    if let hint = string(attribute(element, kAXPlaceholderValueAttribute)) { return hint }
    // A control without a title of its own is often named by the text beside it.
    if let titled = attribute(element, kAXTitleUIElementAttribute), isElement(titled) {
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

/** A line of JSON, or nil when the object can't be written as JSON (never a crash). */
func json(_ object: [String: Any]) -> String? {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return nil }
    return String(data: data, encoding: .utf8)
}

/**
 * The enabled menu-bar item whose shortcut is this key with these modifiers, if the app lists one. Menus give the
 * shortcut as a character (or a virtual key, for keys without one) and modifiers as a mask: 1 Shift, 2 Option,
 * 4 Control, 8 no Command.
 */
func menuItem(for code: CGKeyCode, _ character: String, _ modifiers: Set<String>) -> AXUIElement? {
    guard let bar = attribute(app, kAXMenuBarAttribute), isElement(bar) else { return nil }
    let wanted = (modifiers.contains("shift") ? 1 : 0) | (modifiers.contains("alt") ? 2 : 0) | (modifiers.contains("control") ? 4 : 0)
    var queue = children(bar as! AXUIElement)
    var seen = 0
    while !queue.isEmpty, seen < 3000 {
        let item = queue.removeFirst()
        seen += 1
        let kind = role(item)
        if kind == kAXMenuItemRole as String, flag(item, kAXEnabledAttribute) != false {
            let mask = (attribute(item, kAXMenuItemCmdModifiersAttribute) as? NSNumber)?.intValue
            let char = string(attribute(item, kAXMenuItemCmdCharAttribute))
            let virtual = (attribute(item, kAXMenuItemCmdVirtualKeyAttribute) as? NSNumber)?.intValue
            let same = (!character.isEmpty && char?.lowercased() == character.lowercased()) || (char == nil && virtual == Int(code))
            if mask == wanted, same { return item }
        }
        queue.append(contentsOf: children(item))
    }
    return nil
}

switch command {
case "tree":
    // Bounded every way a big custom view can make it long: depth, elements in all, children of one element, time.
    let maxCount = 4000, maxDepth = 60, maxChildren = 500
    let deadline = Date().addingTimeInterval(20)
    var count = 0
    var notes: [String] = []
    func note(_ text: String) { if !notes.contains(text) { notes.append(text) } }
    func walk(_ element: AXUIElement, _ path: String, _ depth: Int) {
        guard count < maxCount else { return note("Stopped after \(maxCount) elements; the rest of the window isn't listed.") }
        guard depth < maxDepth else { return note("Elements nested deeper than \(maxDepth) levels aren't listed.") }
        guard Date() < deadline else { return note("The app took too long to answer; the rest of the window isn't listed.") }
        count += 1
        let kind = role(element)
        var line: [String: Any] = ["path": path, "depth": depth, "role": kind, "name": name(element, role: kind)]
        if let subrole = string(attribute(element, kAXSubroleAttribute)) { line["subrole"] = subrole }
        if kind != kAXStaticTextRole as String, let value = string(attribute(element, kAXValueAttribute)) { line["value"] = String(value.prefix(200)) }
        if let at = point(attribute(element, kAXPositionAttribute)), let extent = size(attribute(element, kAXSizeAttribute)) {
            line["x"] = Double(at.x); line["y"] = Double(at.y); line["width"] = Double(extent.width); line["height"] = Double(extent.height)
        }
        if flag(element, kAXEnabledAttribute) == false { line["disabled"] = true }
        if flag(element, kAXFocusedAttribute) == true { line["focused"] = true }
        if flag(element, kAXSelectedAttribute) == true { line["selected"] = true }
        if flag(element, kAXExpandedAttribute) == true { line["expanded"] = true }
        var names: CFArray?
        if AXUIElementCopyActionNames(element, &names) == .success {
            let actions = strings(in: names)
            if !actions.isEmpty { line["actions"] = actions }
        }
        // An element whose attributes can't be written as JSON is listed by its place and role alone.
        guard let text = json(line) ?? json(["path": path, "depth": depth, "role": kind, "name": ""]) else { return }
        print(text)
        let (list, total) = children(element, limit: maxChildren)
        if total > list.count { note("An element (\(kind) at \(path)) has \(total) children; only the first \(maxChildren) are read.") }
        for (index, child) in list.enumerated() { walk(child, "\(path).\(index)", depth + 1) }
    }
    for (index, root) in roots() { walk(root, "\(index)", 0) }
    for text in notes { if let line = json(["note": text]) { print(line) } }

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
    let value: CFTypeRef = current.map({ CFGetTypeID($0) == CFNumberGetTypeID() }) == true ? NSNumber(value: Int(arguments[3]) ?? 0) : arguments[3] as CFString
    let result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value)
    if result != .success { fail("Its value can't be set (\(result.rawValue)).") }

case "menubar":
    guard arguments.count >= 3 else { fail("menubar <pid> <File>Export…>", 2) }
    let tidy = { (text: String) -> String in
        text.replacingOccurrences(of: "&", with: "").replacingOccurrences(of: "…", with: "").replacingOccurrences(of: "...", with: "").trimmingCharacters(in: .whitespaces).lowercased()
    }
    let labels = arguments[2].split(separator: ">").map { String($0).trimmingCharacters(in: .whitespaces) }
    guard let bar = attribute(app, kAXMenuBarAttribute), isElement(bar) else { fail("The app has no menu bar.") }
    var items = children(bar as! AXUIElement)
    for (index, label) in labels.enumerated() {
        guard let item = items.first(where: { tidy(name($0, role: role($0))) == tidy(label) }) else {
            fail("No menu item \"\(label)\"; there are: \(items.map { name($0, role: role($0)) }.filter { !$0.isEmpty }.joined(separator: ", ")).")
        }
        if index == labels.count - 1 {
            if flag(item, kAXEnabledAttribute) == false { fail("\"\(label)\" is disabled.") }
            let result = AXUIElementPerformAction(item, kAXPressAction as CFString)
            if result != .success { fail("\"\(label)\" didn't respond (\(result.rawValue)).") }
        } else {
            // A menu's items are the children of its one AXMenu child.
            items = children(item).flatMap { role($0) == kAXMenuRole as String ? children($0) : [$0] }
        }
    }

default:
    // Real input goes to whatever is in front, so the app has to be: brought there with its window key, and checked,
    // never assumed. Keys and text can still go to the app's own process when it won't come forward.
    let front = bringToFront(pid)
    if !front && command != "type" && command != "key" {
        fail("The app didn't come to the front, so this real \(command) wasn't sent (it would reach another app).")
    }
    let source = CGEventSource(stateID: .hidSystemState)
    func send(_ event: CGEvent) {
        if front { event.post(tap: .cghidEventTap) } else { event.postToPid(pid) }
    }
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
                guard let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down) else { continue }
                event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
                send(event)
            }
            usleep(4_000)
        }
    case "key":
        guard arguments.count >= 5, let code = CGKeyCode(arguments[2]) else { fail("key <pid> <code> <modifiers> <character>", 2) }
        let modifiers = Set(arguments[3].split(separator: ",").map(String.init))
        let character = arguments[4]
        // A shortcut with Command is what a menu item answers to: choose that item, which works whatever has focus.
        if modifiers.contains("command"), AXIsProcessTrusted(), let item = menuItem(for: code, character, modifiers) {
            if AXUIElementPerformAction(item, kAXPressAction as CFString) == .success { exit(0) }
        }
        // Modifier keys go down first and up last, as a person's do, so apps that watch the modifiers see them.
        let modifierKeys: [(name: String, code: CGKeyCode, flag: CGEventFlags)] = [
            ("command", 55, .maskCommand), ("shift", 56, .maskShift), ("alt", 58, .maskAlternate), ("control", 59, .maskControl)
        ]
        let held = modifierKeys.filter { modifiers.contains($0.name) }
        var flags: CGEventFlags = []
        func key(_ code: CGKeyCode, _ down: Bool) {
            guard let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { return }
            event.flags = flags
            send(event)
            usleep(8_000)
        }
        for modifier in held { flags.insert(modifier.flag); key(modifier.code, true) }
        key(code, true)
        key(code, false)
        for modifier in held.reversed() { flags.remove(modifier.flag); key(modifier.code, false) }
    default:
        fail("\(command) isn't a command.", 2)
    }
}
