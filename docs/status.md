# Status and limits

facetshot is at version 0.1, and the config format may change before 1.0. This page is the one
place that says what has and hasn't been tried; other pages describe how things are meant to work.

## Platform support

|                                                 | macOS                                                                   | Linux                    | Windows                          |
| ----------------------------------------------- | ----------------------------------------------------------------------- | ------------------------ | -------------------------------- |
| Web pages in Chromium and WebKit                | tested                                                                  | expected, untested       | expected, untested               |
| Web pages in Firefox                            | not yet seen working (see below)                                        | expected, untested       | expected, untested               |
| Storybook, Electron                             | tested                                                                  | expected, untested       | expected, untested               |
| Sessions and the background helper              | tested                                                                  | untested                 | probably not working (see below) |
| Mac windows: screenshots, steps, sessions, logs | tested                                                                  | not available            | not available                    |
| iOS simulator screenshots and label steps       | tested by hand; CI needs a macOS runner with Xcode                      | not available            | not available                    |
| SwiftUI scenes                                  | tested; CI needs a macOS runner with Xcode                              | not available            | not available                    |
| Flutter                                         | web tested; macOS not run end to end; iOS untested                      | expected, untested (web) | expected, untested (web)         |
| Tauri                                           | the UI in WebKit tested; the real window run by hand, no automated test | planned                  | planned                          |
| Android                                         | planned                                                                 | planned                  | planned                          |

"Expected" means the feature uses only Playwright, which behaves the same on that system, but nobody has tried it
there yet. Reports are welcome. No [CI](ci.md) provider has been tried yet.

## Known limits

- **Installing:** `bun add -g` (from npm and from a packed tarball), `bunx facetshot` from npm, a tagged version from
  GitHub, `facetshot setup`, `init --agent all` and `uninstall --yes` in a folder with no `package.json` were run on
  macOS. In 0.1.0, `uninstall` run through `bunx` wrongly says facetshot is installed in the project; the next
  version fixes it. `uninstall --browsers` hasn't been run; it calls Playwright's own `uninstall`.

- **Firefox:** Playwright's Firefox build hasn't been confirmed working on macOS yet. `moz-firefox` (the installed
  Firefox app) is driven over WebDriver BiDi, which Playwright supports only experimentally.
- **New iOS steps, not yet run on a simulator:** steps that name an element by role (`role=button[name="Save"]`) or
  by a point, long presses (and right-clicks, which become long presses), drags, and the app's system log are written
  but haven't been run on a simulator yet. There is no automated iOS test.
- **Simulator shutdown and iOS typing, not yet run on a simulator:** simulators shut down after
  `FACETSHOT_SIMULATOR_IDLE_MINUTES` (and idle ones first under memory pressure), the SwiftUI driver's simulator is
  now shut down too, and typed text keeps its line breaks (a `\n` presses Return). These are written but haven't been
  run end to end on a simulator yet.
- **Sessions** don't open iOS simulators or Storybook stories yet. Use [flows](flows.md) for those.
- **Flutter on macOS:** Flutter 3.24's own build tool fails `flutter build macos` with recent Xcode versions (it
  misreads `lipo`'s output), so a Flutter Mac app hasn't been run end to end. Use a newer Flutter; the web build is
  not affected.
- **Tauri's real window** was run by hand on macOS: a flow pressed a link through Accessibility, and the Rust side's
  `println!` came back in the logs. No automated test covers it.
- **`wait` with a number on iOS:** `wait:500` pauses on web pages and in Mac windows; on the iOS simulator it is
  still read as an accessibility label to wait for, and fails after 15 s.
- **Mac keys and focus:** `press:Enter` and `press:Tab` into a SwiftUI text editor, a menu shortcut
  (`press:Meta+N`), bringing the window to the front and a window with an 800-child custom view are covered by
  `test/mac.test.ts` on macOS 27. A shortcut no menu item lists is sent as a key press to the key window; that path
  was run by hand on the same app, not in a test. AppKit apps other than the SwiftUI fixture haven't been tried.
- **Mac permissions:** steps and sessions in Mac windows need Accessibility, and resizing a window from outside needs
  Automation. See [Desktop apps](desktop.md#permissions).
- **iOS variants:** on the iOS simulator, locale, right-to-left, personas, offline and reduced motion aren't applied
  yet. See [Variants on iOS](ios.md#variants-on-ios).
- **Windows:** the background helper listens on a Unix socket and stops work by process group. Neither is expected to
  work on Windows, so sessions there probably don't, and runs may fall back to working in the calling process. The
  load brake is off, because Windows has no load average.
- **Tauri** on Windows (WebView2) and Linux (WebKitGTK) isn't supported.
- **FacetshotKit:** the path for test targets hosted in an app (which can draw Liquid Glass and sheets) is written but
  not yet covered by tests. See the [FacetshotKit README](../FacetshotKit/README.md#how-a-screenshot-is-taken).
