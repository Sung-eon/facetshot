# Status and limits

facetshot is at version 0.1. It isn't on npm yet, and the config format may change before 1.0.

## Platform support

|                                                 | macOS                                                         | Linux                    | Windows                  |
| ----------------------------------------------- | ------------------------------------------------------------- | ------------------------ | ------------------------ |
| Web pages in Chromium and WebKit                | tested                                                        | expected, untested       | expected, untested       |
| Web pages in Firefox                            | not yet seen working (see below)                              | expected, untested       | expected, untested       |
| Storybook, Electron                             | tested                                                        | expected, untested       | expected, untested       |
| Sessions and logs (web, Electron)               | tested                                                        | expected, untested       | expected, untested       |
| Mac windows: screenshots, steps, sessions, logs | tested                                                        | not available            | not available            |
| iOS simulator, SwiftUI                          | tested                                                        | not available            | not available            |
| Flutter                                         | web tested; macOS and iOS through the Mac and iOS paths       | expected, untested (web) | expected, untested (web) |
| Tauri                                           | the UI in WebKit tested; the real window through the Mac path | planned                  | planned                  |
| Android                                         | planned                                                       | planned                  | planned                  |

"Expected" means the feature uses only Playwright, which behaves the same on that system, but nobody has tried it
there yet. Reports are welcome.

## Known limits

- Playwright's Firefox build didn't start on the prerelease version of macOS it was tried on, so Firefox hasn't been
  seen working yet. `moz-firefox` (the installed Firefox app) is driven over WebDriver BiDi, which Playwright
  supports only experimentally.
- [Sessions](sessions.md) don't open iOS simulators or Storybook stories yet. Use [flows](flows.md) for those.
- On the iOS simulator, steps that name an element by role (`role=button[name="Save"]`) or by a point, long presses,
  drags and the app's system log are new in this version and have been tried on fewer setups than the rest.
- Steps and sessions in Mac windows need the Accessibility permission (see
  [Desktop apps](desktop.md#permissions)).
- Flutter 3.24's own build tool fails `flutter build macos` with recent Xcode versions (it misreads `lipo`'s output).
  Use a newer Flutter for the macOS app; the web build is not affected.
- On the iOS simulator, locale, right-to-left, personas, offline and reduced motion aren't applied yet. See
  [Variants on iOS](ios.md#variants-on-ios).
- Tauri on Windows (WebView2) and Linux (WebKitGTK) isn't supported.
- On Windows, the load brake that slows work on a busy machine is off, because Windows has no load average.
- FacetshotKit's path for test targets hosted in an app (which can draw Liquid Glass and sheets) is written but not
  yet covered by tests. See the [FacetshotKit README](../FacetshotKit/README.md#how-a-screenshot-is-taken).
