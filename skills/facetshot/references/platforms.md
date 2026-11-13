# Platforms

- [Web apps and live sites](#web-apps-and-live-sites)
- [Electron](#electron)
- [Tauri](#tauri)
- [Native Mac apps](#native-mac-apps)
- [Flutter](#flutter)
- [iOS simulators](#ios-simulators)
- [Storybook](#storybook)
- [SwiftUI previews](#swiftui-previews)
- [What has been tried](#what-has-been-tried)

## Web apps and live sites

Paths (`/settings`) need the config to say where the app is: `web.baseURL` (something already running, staging or
production), `web.build` + `web.serve` (facetshot builds when inputs change and starts the server), or `web.build`
with an `output` folder and no `serve` (facetshot serves the static files itself, e.g. a single-page app or
Flutter's `build/web`). A full URL needs no config. Screenshots are of a production build unless the config serves
a dev server.

On a live site, steps act as the signed-in user, for real. Use test accounts, and do only what you were asked to.
`web.block` aborts requests by URL pattern (analytics, payments) and is worth setting for live sites.

## Electron

`desktop: { kind: 'electron', main: '.' }`. The app is launched through Playwright, so its window gets everything a
web page gets: variants, readiness rules, checks, flows and sessions. Devices are window sizes (`window`,
`window-small`). `app:/reports` reaches a screen as `desktop.navigate` says (`hash` by default). A `menu:` step
chooses from the app's menu bar, so the main-process handler runs. The main process's console and output are in the
logs as `main`. Personas don't apply to Electron. Runs and sessions launch their own copy of the app, so an app
that allows only one instance can't have a session and a run at the same time.

## Tauri

Two ways, chosen by `desktop.engine`:

- **`webkit`** (the default when `desktop.frontend` is set): the web UI in Playwright's WebKit, Tauri's engine on
  macOS, with full checks, flows and sessions. There is no Rust side: `invoke()` calls are answered from
  `desktop.invoke` in the config, and a command not listed there fails with a console error naming it.
- **`window`** (macOS): the built `.app`, launched for real and reached by deep link (`desktop.navigate` is its
  scheme). Steps and sessions work through the Mac's accessibility, as for native Mac apps; the Rust side's output
  (`println!`) is in the logs as `app`. A deep link can reach another installed copy of the app with the same
  scheme. No page checks here.

## Native Mac apps

`desktop: { kind: 'macos', app: 'path/to/App.app' }` (or a `build` step). The app is launched from its binary with
a home folder of facetshot's own, told its window size and appearance in its environment
(`FACETSHOT_WINDOW_SIZE`, `FACETSHOT_APPEARANCE`, `FACETSHOT_TEXT`) and the screen to show in `FACETSHOT_ROUTE`;
each screen is a fresh launch. The window alone is captured, never the rest of the screen.

Permissions belong to the app facetshot runs in (a terminal, or the agent's app; precisely, whatever started the
background helper):

- **Screen Recording** for any screenshot of a window.
- **Accessibility** for steps and sessions (pressing, typing, menus). Screenshots alone don't need it.
- **Automation** of System Events, to resize a window an app doesn't size itself.

`facetshot doctor` reports the first two. If a response says one is missing, tell the person where to allow it
(System Settings → Privacy & Security); retrying won't help.

## Flutter

- **Web** (`flutter build web`, served from `build/web`): Flutter draws into a canvas, so facetshot turns on its
  accessibility tree and waits for its first frame. Checks, refs and `role=…[name=…]` all work through that tree;
  popup menu items are named as buttons.
- **macOS:** an ordinary Mac app (above). **iOS:** an ordinary simulator app (below).
- `debugPrint` reaches the web console, and standard output on macOS.

## iOS simulators

Needs Xcode and an `apple` section (`bundleId`, a `scheme` for deep links, and the app or its build). facetshot
uses simulators of its own, boots at most two at once, opens screens by deep link, sets appearance, text size and
contrast from outside, and turns the device for landscape. Flows press, type, long-press and drag through a small
UI-test runner; the first run builds it, which takes minutes. Screenshots come from the simulator, without page
checks. The app's system log is recorded; Swift's `print` isn't. Sessions don't open simulators yet: use flows.

## Storybook

`storybook: { url }` for a running Storybook, or `storybook: { build }` for a static build facetshot serves.
`story:button--primary` takes one story, `story:Button/*` a pattern. Stories are web pages: checks, flows and
variants work; sessions don't open stories.

## SwiftUI previews

`preview:Name` draws SwiftUI scenes in a test process without launching the app, through FacetshotKit (a Swift
package the project adds to a test target, with a test listing its scenes). It needs Xcode; Liquid Glass, blur,
sheets and alerts don't render there.

## What has been tried

Web pages, Storybook, Electron, Tauri's frontend, native Mac apps and the iOS simulator have been run on macOS.
Tauri's real window has been run by hand. Newer and less tried: iOS steps by role or point, long press, drag and
iOS logs; Flutter on macOS and iOS. Linux and Windows haven't been tried; the background helper and sessions
probably don't work on Windows. If something fails in a way that looks like facetshot's limit rather than the app's,
say so plainly.
