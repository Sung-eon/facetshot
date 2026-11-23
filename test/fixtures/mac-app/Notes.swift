// A tiny SwiftUI Mac app for facetshot's tests of Mac windows: a button, a text field, a text editor, a context menu
// and menu bar commands (one with a shortcut), each of which prints a line to standard output so a test can see it was
// really pressed. On /canvas it shows a large custom view whose accessibility children are many and partly malformed,
// as a drawing canvas's can be. Built with swiftc (no Xcode project): see test/mac.test.ts.
import AppKit
import OSLog
import SwiftUI

let log = Logger(subsystem: "dev.facetshot.test.notes", category: "notes")

@main
struct NotesApp: App {
    init() {
        // Launched from its binary, an app without a bundle identifier still comes to the front.
        NSApplication.shared.setActivationPolicy(.regular)
        print("Started on \(ProcessInfo.processInfo.environment["FACETSHOT_ROUTE"] ?? "/")")
    }

    var body: some Scene {
        WindowGroup("Notes") {
            NotesView()
                .frame(width: size.width, height: size.height)
        }
        .windowResizability(.contentSize)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Note") { print("New note") }.keyboardShortcut("n")
            }
            CommandMenu("Note") {
                Button("Export…") { print("Exported 2 notes") }
            }
        }
    }

    /** FACETSHOT_WINDOW_SIZE=WxH, as facetshot asks for each device. */
    var size: CGSize {
        let parts = (ProcessInfo.processInfo.environment["FACETSHOT_WINDOW_SIZE"] ?? "640x420").split(separator: "x")
        return CGSize(width: Double(parts.first ?? "640") ?? 640, height: Double(parts.last ?? "420") ?? 420)
    }
}

struct NotesView: View {
    @State private var name = "Ada"
    @State private var saved = false
    @State private var text = ""

    var body: some View {
        if ProcessInfo.processInfo.environment["FACETSHOT_ROUTE"] == "/canvas" {
            VStack(alignment: .leading) {
                Text("Canvas")
                CanvasView()
            }
            .padding(24)
        } else {
            form
        }
    }

    var form: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Notes").font(.largeTitle)
            TextField("Name", text: $name)
                .textFieldStyle(.roundedBorder)
                .frame(width: 240)
            Button("Save") {
                saved = true
                print("Saved \(name)")
                log.notice("Saved a note for \(name, privacy: .public)")
            }
            if saved { Text("Saved.") }
            Text("Right-click here")
                .padding(12)
                .background(.quaternary)
                .contextMenu {
                    Button("Copy link") { print("Copied link") }
                    Button("Reset") { print("Reset") }
                }
            TextEditor(text: $text)
                .frame(width: 240, height: 60)
                .border(.secondary)
                .accessibilityLabel("Body")
                .onChange(of: text) { print("Body: \(text.debugDescription)") }
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/** A big custom view, as a canvas is: 800 accessible children, some of them not elements at all, one with no real frame. */
struct CanvasView: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView { Canvas() }
    func updateNSView(_ view: NSView, context: Context) {}

    final class Canvas: NSView {
        lazy var parts: [Any] = (0..<800).map { index -> Any in
            if index % 100 == 7 { return "not an element" }
            if index % 100 == 9 { return NSNumber(value: index) }
            let part = NSAccessibilityElement()
            part.setAccessibilityRole(.staticText)
            part.setAccessibilityLabel("Shape \(index)")
            part.setAccessibilityParent(self)
            part.setAccessibilityFrame(index == 3 ? NSRect(x: CGFloat.nan, y: .infinity, width: .nan, height: 1) : NSRect(x: 40 + index % 20, y: 40 + index / 20, width: 4, height: 4))
            return part
        }
        override var intrinsicContentSize: NSSize { NSSize(width: 400, height: 300) }
        override func isAccessibilityElement() -> Bool { true }
        override func accessibilityRole() -> NSAccessibility.Role? { .group }
        override func accessibilityLabel() -> String? { "Drawing" }
        override func accessibilityChildren() -> [Any]? { parts }
        override func draw(_ dirtyRect: NSRect) {
            NSColor.systemTeal.setFill()
            dirtyRect.fill()
        }
    }
}
