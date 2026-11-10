# Desktop apps

facetshot takes pictures of desktop apps' windows at the sizes you choose: Electron apps, Tauri apps and native Mac
apps. Desktop targets are written `app:/path`, and the devices are window sizes — `window` (1280×800),
`window-small` (960×640), `mac` and `mac-narrow` (1280×800 and 1040×640) — or your own:

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

- **`main`** is your app's entry (`.` uses `package.json`'s `main`) or a packaged executable. `executable` points at a
  different Electron binary if you need one.
- **`navigate`** says how `app:/reports` reaches a screen:
  - `hash` (the default) sets `location.hash` to `#/reports`.
  - a URL with `{path}`, such as `app://local/{path}`, loads that address.
  - `ipc:<channel>` sends the path on that channel, as if your renderer had sent it, for apps that route in the
    main process.
- **Dark mode** is set through `nativeTheme.themeSource`, as the system setting would; text size and direction the
  same way as on the web; `locale` through Electron's `--lang`, `timezone` through `TZ`.
- The window is resized to each device's size and checked; if your app keeps a minimum size, the picture notes it.

Electron opens a real window while it works (only the page is captured, never the screen). Apps run one at a time,
because many take a single-instance lock.

## Tauri

Tauri draws its UI in the system's web view, which on macOS (WKWebView) can't be automated. facetshot gives you two
ways to see it.

**The UI in WebKit (the default).** Point facetshot at your frontend and it renders it in Playwright's WebKit — the
same engine as WKWebView — at each window size, with everything the web gets: readiness, checks, flows.

```ts
desktop: {
	kind: 'tauri',
	frontend: {
		build: { cmd: 'npx vite build', inputs: ['src', 'index.html'], output: 'dist' },
		cmd: 'npx vite preview --port {port} --strictPort',
		port: 'auto'
	},
	invoke: { greet: 'Hello, Ada!', list_items: [] }
}
```

There's no Rust backend in the browser, so `invoke` holds canned answers for your commands. A command that isn't
listed is rejected with an error naming it, which the console check reports. Event calls are stubbed, and
`isTauri()` is true.

**The real window (macOS).** For the app as users get it — native menus and title bar included — facetshot can launch
the built app, open each screen by deep link and capture its window:

```ts
desktop: {
	kind: 'tauri',
	engine: 'window',
	app: 'src-tauri/target/release/bundle/macos/MyApp.app',
	build: { cmd: 'npx tauri build --bundles app', inputs: ['src', 'src-tauri/src'], heavy: true },
	navigate: 'myapp'
}
```

This needs the [deep-link plugin](https://v2.tauri.app/plugin/deep-linking/) registered for your scheme, and Screen
Recording permission (see below). facetshot passes `FACETSHOT_WIDTH`, `FACETSHOT_HEIGHT` and `FACETSHOT_APPEARANCE`
to the app so it can size its window and pick a theme at startup.

Tauri on Windows (WebView2) and Linux (WebKitGTK) isn't supported yet. WebView2 can be driven over the Chrome
DevTools Protocol and Linux through `tauri-driver`; both are planned.

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
instead and leave `desktop` out — `app:` targets then go to the simulator on iOS devices and to the Mac app on window
devices.

facetshot launches the app for each picture, finds its window and captures only that window. (Sending a deep link to
a running SwiftUI app opens a second window instead of navigating the first, so the screen is given at launch.) It tells
the app what it wants through environment variables, which a few lines in your app's debug build can honour:

| Variable | Means |
|---|---|
| `FACETSHOT_ROUTE` | the deep link (`myapp:///settings`) to open at launch |
| `FACETSHOT_WINDOW_SIZE` | `1280x800`: size the main window's content to this |
| `FACETSHOT_APPEARANCE` | `light` or `dark` |
| `FACETSHOT_TEXT` | `default`, `large`, `xlarge` or `xxl` |
| `FACETSHOT_READY_FILE` | write this file when the screen has finished loading (with `readyFile: true`) |

Without a ready file, facetshot waits until two captures in a row are identical. If the app doesn't size its own
window, facetshot asks System Events to resize it, which needs the Accessibility permission. Pictures come out at the
display's own scale, so on a non-Retina display a 1280×800 window is a 1280×800 picture; the title bar is included.

Only one Mac app run happens at a time on a machine (they share the screen).

### Screen Recording permission

Capturing a window needs the Screen Recording permission for whatever runs facetshot — your terminal, your editor, or
your agent's app. macOS asks the first time; if it doesn't, or you said no, turn it on in **System Settings → Privacy &
Security → Screen & System Audio Recording**, then restart that app. `facetshot doctor` reminds you.
