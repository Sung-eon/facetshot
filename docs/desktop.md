# Desktop apps

facetshot takes screenshots of desktop app windows at the sizes you choose: Electron apps, Tauri apps and native Mac
apps. Desktop targets are written `app:/path`. The devices are window sizes: `window` (1280×800), `window-small`
(960×640), `mac` and `mac-narrow` (1280×800 and 1040×640), or your own:

```ts
devices: { 'window-wide': { platform: 'window', width: 1600, height: 1000, scale: 2 } }
```

Say which kind of app it is under `desktop`.

## Electron

```ts
desktop: { kind: 'electron', main: '.', navigate: 'hash' }
```

facetshot launches your app through Playwright and drives its first window like a browser page, so everything the
web gets works here too: variants, readiness rules, checks, flows and masks.

- `main` is your app's entry (`.` uses the `main` field of `package.json`) or a packaged executable. `executable`
  points at a different Electron binary if you need one.
- `navigate` says how `app:/reports` reaches a screen:
  - `hash` (the default) sets `location.hash` to `#/reports`.
  - A URL with `{path}`, such as `app://local/{path}`, loads that address.
  - `ipc:<channel>` sends the path on that channel, as if your renderer had sent it, for apps that route in the main
    process.
- Dark mode is set through `nativeTheme.themeSource`, as the system setting would set it. Text size and direction
  work as on the web, `locale` uses Electron's `--lang`, and `timezone` uses `TZ`.
- The window is resized to each device's size and checked; if your app enforces a minimum size, the screenshot's
  notes say so.

Electron opens a real window while it works, but only the page is captured, never the screen. Apps run one at a time,
because many take a single-instance lock.

## Tauri

Tauri draws its UI in the system's web view, which on macOS (WKWebView) can't be automated from outside. facetshot
offers two ways to see it.

The UI in WebKit (the default). Point facetshot at your frontend, and it renders it in Playwright's WebKit, the same
engine as WKWebView, at each window size, with everything the web gets: readiness, checks and flows.

```ts
desktop: {
	kind: 'tauri',
	frontend: {
		build: { cmd: 'bunx --bun vite build', inputs: ['src', 'index.html'], output: 'dist' },
		cmd: 'bunx --bun vite preview --port {port} --strictPort',
		port: 'auto'
	},
	invoke: { greet: 'Hello, Ada!', list_items: [] }
}
```

There's no Rust backend in the browser, so `invoke` holds fixed answers for your commands. A command that isn't
listed is rejected with an error naming it, which the console check reports. Event calls are stubbed, and
`isTauri()` is true.

The real window (macOS). For the app as users get it, with native menus and title bar, facetshot can launch the built
app, open each screen by deep link and capture its window:

```ts
desktop: {
	kind: 'tauri',
	engine: 'window',
	app: 'src-tauri/target/release/bundle/macos/MyApp.app',
	build: { cmd: 'bunx tauri build --bundles app', inputs: ['src', 'src-tauri/src'], heavy: true },
	navigate: 'myapp'
}
```

This needs the [deep-link plugin](https://v2.tauri.app/plugin/deep-linking/) registered for your scheme, and the
[Screen Recording permission](#screen-recording-permission). facetshot passes `FACETSHOT_WIDTH`, `FACETSHOT_HEIGHT`
and `FACETSHOT_APPEARANCE` to the app so it can size its window and choose a theme at startup. This path hasn't been
run yet; see [Status and limits](status.md).

## Native Mac apps

For a Mac app built with AppKit, SwiftUI or Catalyst:

```ts
desktop: {
	kind: 'macos',
	app: 'build/Debug/MyApp.app',
	navigate: 'myapp'
}
```

If the same app also runs on iOS and you've set up `apple` for the simulator, put the Mac build under `apple.macos`
instead and leave `desktop` out. `app:` targets then go to the simulator on iOS devices and to the Mac app on window
devices.

facetshot launches the app for each screenshot, finds its window and captures only that window. (Sending a deep link
to a running SwiftUI app opens a second window instead of navigating the first, so the screen is given at launch.)
It tells the app what it wants through environment variables, which a few lines in your app's debug build can
follow:

| Variable                | Means                                                                         |
| ----------------------- | ----------------------------------------------------------------------------- |
| `FACETSHOT_ROUTE`       | the deep link (`myapp:///settings`) to open at launch                         |
| `FACETSHOT_WINDOW_SIZE` | `1280x800`: size the main window's content to this                            |
| `FACETSHOT_APPEARANCE`  | `light` or `dark`                                                             |
| `FACETSHOT_TEXT`        | `default`, `large`, `xlarge` or `xxl`                                         |
| `FACETSHOT_READY_FILE`  | write this file when the screen has finished loading (with `readyFile: true`) |

Without a ready file, facetshot waits until two captures in a row are identical. If the app doesn't size its own
window, facetshot asks System Events to resize it, which needs the Accessibility permission. Screenshots are taken at
the display's own scale, so on a non-Retina display a 1280×800 window gives a 1280×800 screenshot. The title bar is
included.

Only one Mac app run happens at a time on a machine, since they share the screen.

### Screen Recording permission

Capturing a window needs the Screen Recording permission for whatever runs facetshot: your terminal, your editor or
your agent's app. macOS asks the first time. If it doesn't, or you said no, turn it on in System Settings → Privacy &
Security → Screen & System Audio Recording, then restart that app. `facetshot doctor` reminds you.
