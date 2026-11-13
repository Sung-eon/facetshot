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
| iOS simulator screenshots and label steps       | tested by hand                                                          | not available            | not available                    |
| SwiftUI scenes                                  | tested                                                                  | not available            | not available                    |
| Flutter                                         | web tested; macOS not run end to end; iOS untested                      | expected, untested (web) | expected, untested (web)         |
| Tauri                                           | the UI in WebKit tested; the real window run by hand, no automated test | planned                  | planned                          |
| Android                                         | planned                                                                 | planned                  | planned                          |

"Expected" means the feature uses only Playwright, which behaves the same on that system, but nobody has tried it
there yet. Reports are welcome.

## Known limits

- **Firefox:** Playwright's Firefox build hasn't been confirmed working on macOS yet. `moz-firefox` (the installed
  Firefox app) is driven over WebDriver BiDi, which Playwright supports only experimentally.
- **New iOS steps, not yet run on a simulator:** steps that name an element by role (`role=button[name="Save"]`) or
  by a point, long presses (and right-clicks, which become long presses), drags, and the app's system log are written
  but haven't been run on a simulator yet. There is no automated iOS test.
- **Sessions** don't open iOS simulators or Storybook stories yet. Use [flows](flows.md) for those.
- **Flutter on macOS:** Flutter 3.24's own build tool fails `flutter build macos` with recent Xcode versions (it
  misreads `lipo`'s output), so a Flutter Mac app hasn't been run end to end. Use a newer Flutter; the web build is
  not affected.
- **Tauri's real window** was run by hand on macOS: a flow pressed a link through Accessibility, and the Rust side's
  `println!` came back in the logs. No automated test covers it.
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
