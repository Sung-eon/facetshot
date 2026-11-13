# Status and limits

facetshot is at version 0.1. It isn't on npm yet, and the config format may change before 1.0.

## Platform support

|                                     | macOS                                           | Linux              | Windows            |
| ----------------------------------- | ----------------------------------------------- | ------------------ | ------------------ |
| Web pages in Chromium and WebKit    | tested                                          | expected, untested | expected, untested |
| Web pages in Firefox                | not yet seen working (see below)                | expected, untested | expected, untested |
| Storybook, Electron                 | tested                                          | expected, untested | expected, untested |
| Sessions and logs (web)             | tested                                          | expected, untested | expected, untested |
| iOS simulator, SwiftUI, Mac windows | tested                                          | not available      | not available      |
| Tauri                               | the UI in WebKit tested; the app window not yet | planned            | planned            |
| Android                             | planned                                         | planned            | planned            |

"Expected" means the feature uses only Playwright, which behaves the same on that system, but nobody has tried it
there yet. Reports are welcome.

## Known limits

- Playwright's Firefox build didn't start on the prerelease version of macOS it was tried on, so Firefox hasn't been
  seen working yet. `moz-firefox` (the installed Firefox app) is driven over WebDriver BiDi, which Playwright
  supports only experimentally.
- [Sessions](sessions.md) open web pages, Electron windows and Tauri frontends. Sessions on iOS simulators, native
  Mac windows (including Tauri's real window) and Storybook stories are planned; use [flows](flows.md) for those
  until then.
- [Logs](logs.md) from iOS simulator apps and native Mac apps aren't recorded yet. The output of servers facetshot
  started is still recorded on those platforms.
- On the iOS simulator, locale, right-to-left, personas, offline and reduced motion aren't applied yet. See
  [Variants on iOS](ios.md#variants-on-ios).
- The real Tauri window (`engine: 'window'`) is written but hasn't been run yet. Tauri on Windows (WebView2) and
  Linux (WebKitGTK) isn't supported.
- On Windows, the load brake that slows work on a busy machine is off, because Windows has no load average.
- FacetshotKit's path for test targets hosted in an app (which can draw Liquid Glass and sheets) is written but not
  yet covered by tests. See the [FacetshotKit README](../FacetshotKit/README.md#how-a-screenshot-is-taken).
