// A tiny SwiftUI Mac app for facetshot's tests of Mac windows: a button, a text field, a context menu and a menu bar
// command, each of which prints a line to standard output so a test can see it was really pressed. Built with swiftc
// (no Xcode project): see test/mac.test.ts.
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

    var body: some View {
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
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
