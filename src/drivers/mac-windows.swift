// facetshot's window finder for Mac apps (`src/drivers/macos.ts`), compiled once with swiftc into ~/.facetshot/bin.
//
//   mac-windows check   prints `granted` if this process may record the screen (and so picture a window), else `denied`
//   mac-windows <pid>   the windows that process has on screen, one per line: `<id> <width> <height>`, largest last
//
// Only the given process's own windows are listed, so a picture is that window and nothing else on the person's screen.
import CoreGraphics
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: mac-windows check | <pid>\n".utf8))
    exit(2)
}
if arguments[1] == "check" {
    print(CGPreflightScreenCaptureAccess() ? "granted" : "denied")
    exit(0)
}
guard let pid = Int(arguments[1]) else { exit(2) }
let all = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let mine = all.filter { ($0[kCGWindowOwnerPID as String] as? Int) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 }
let sized = mine.compactMap { window -> (id: Int, width: Double, height: Double)? in
    guard let id = window[kCGWindowNumber as String] as? Int, let bounds = window[kCGWindowBounds as String] as? [String: Double] else { return nil }
    let width = bounds["Width"] ?? 0, height = bounds["Height"] ?? 0
    // Tooltips and drag images are windows too; a window worth a picture is at least 200 × 200.
    return width * height > 40_000 ? (id, width, height) : nil
}
for window in sized.sorted(by: { $0.width * $0.height < $1.width * $1.height }) {
    print("\(window.id) \(Int(window.width)) \(Int(window.height))")
}
