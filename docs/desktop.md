# Desktop apps

facetshot takes screenshots of desktop app windows at the sizes you choose, and plays [flows](flows.md) and opens
[sessions](sessions.md) in them: Electron apps, Tauri apps and native Mac apps (Flutter's included). Desktop targets are written `app:/path`. The devices are window sizes: `window` (1280×800), `window-small`
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
- The app's own menu bar is reached with a `menu:` step, `menu: File>Export Report…`. The item's handler runs in the
  main process, as if it had been clicked. Labels match whatever their case, `&` and trailing `…`.
- The main process is part of the log: its `console` messages, with their level, and anything else it or its native
  modules write to standard output (as `info`) and standard error (as `warn`).
- [Sessions](sessions.md) open the app too: `facetshot open app:/ --on window` launches it, and `close` quits it.

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

This needs the [deep-link plugin](https://v2.tauri.app/plugin/deep-linking/) registered for your scheme (for any
screen but `/`), and the [permissions](#permissions) below. facetshot passes `FACETSHOT_WIDTH`, `FACETSHOT_HEIGHT` and
`FACETSHOT_APPEARANCE` to the app so it can size its window and choose a theme at startup.

Here the Rust side runs for real. Flows take every step a Mac window takes ([below](#steps-in-a-mac-window)), what
the Rust side prints (`println!`, or the `log` crate writing to the terminal) is in the logs, and
[sessions](sessions.md) open the real window too.

## Native Mac apps

For a Mac app built with AppKit, SwiftUI, Catalyst or Flutter:

```ts
desktop: {
	kind: 'macos',
	app: 'build/Debug/MyApp.app'
}
```

If the same app also runs on iOS and you've set up `apple` for the simulator, put the Mac build under `apple.macos`
instead and leave `desktop` out. `app:` targets then go to the simulator on iOS devices and to the Mac app on window
devices.

facetshot launches the app for each screenshot, finds its window and captures only that window. (Sending a deep link
to a running SwiftUI app opens a second window instead of navigating the first, so the screen is given at launch.)
It tells the app what it wants through environment variables, which a few lines in your app's debug build can
follow:

| Variable                | Means                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `FACETSHOT_ROUTE`       | the screen to open at launch: `/settings`, or the deep link `myapp:///settings` when `navigate` names a scheme |
| `FACETSHOT_WINDOW_SIZE` | `1280x800`: size the main window's content to this                                                             |
| `FACETSHOT_APPEARANCE`  | `light` or `dark`                                                                                              |
| `FACETSHOT_TEXT`        | `default`, `large`, `xlarge` or `xxl`                                                                          |
| `FACETSHOT_READY_FILE`  | write this file when the screen has finished loading (with `readyFile: true`)                                  |

Without a ready file, facetshot waits until two captures in a row are identical. If the app doesn't size its own
window, facetshot asks System Events to resize it, which needs the Accessibility permission. Screenshots are taken at
the display's own scale, so on a non-Retina display a 1280×800 window gives a 1280×800 screenshot. The title bar is
included.

Only one Mac app run happens at a time on a machine, since they share the screen.

What the app prints and writes to the system log is kept with each screenshot; see
[Logs](logs.md#apps-outside-the-browser).

## Steps in a Mac window

Native Mac apps and Tauri's real window take the same [steps](flows.md#steps) as a web page, in flows and in
[sessions](sessions.md), through macOS's Accessibility interface:

- A step on an element (`click: role=button[name="Save"]`, or a ref such as `e12` in a session) uses the element's
  own action, the one a screen reader would use. The pointer isn't moved and the app doesn't need to be in front. If
  the element offers no such action, or it fails (SwiftUI's context menus do), facetshot clicks it for real instead.
- A point (`@120,80`, in points from the window's top left), a drag, a hover, and typing are real input: the app is
  brought to the front, and the pointer moves.
- `fill` focuses the field, selects its text, and types, so the app sees the same key presses a person makes.
- `menu: File>Export…` chooses from the app's menu bar.

An element is named by a ref, `role=<role>[name="…"]`, `text=…`, `label=…` or a point. Roles use the web's names
(`button`, `textbox`, `checkbox`, `menuitem`…). CSS selectors don't work in a Mac window, and `longpress`, `back`,
`forward` and `reload` are refused.

## Permissions

Both are given to whatever runs facetshot (your terminal, your editor or your agent's app), in System Settings →
Privacy & Security. `facetshot doctor` says which are missing.

| Permission                      | Needed for                                                             |
| ------------------------------- | ---------------------------------------------------------------------- |
| Screen & System Audio Recording | screenshots of a Mac window (restart the app after allowing it)        |
| Accessibility                   | steps and sessions in a Mac window, and resizing a window from outside |
