# Desktop apps

facetshot takes screenshots of desktop app windows at the sizes you choose, and plays [flows](flows.md) and opens
[sessions](sessions.md) in them: Electron apps, Tauri apps and native Mac apps (Flutter's included). Desktop targets
are written `app:/path`; the app opens each one by [deep link](concepts.md#glossary) or by its own routing. The
devices are window sizes: `window` (1280×800), `window-small` (960×640), `mac` and `mac-narrow` (1280×800 and
1040×640), or your own:

```ts
devices: { 'window-wide': { platform: 'window', width: 1600, height: 1000, scale: 2 } }
```

Say which kind of app it is under `desktop`.

## Electron

```ts
desktop: { kind: 'electron', main: '.', navigate: 'hash' }
```

facetshot launches your app through Playwright and drives its first window like a browser page, so most of what the
web gets works here too: variants, readiness rules, checks, flows and masks. Personas don't apply yet: cookies,
headers, `storageState` and `login` are ignored, so a persona variant shows whoever the app signs in itself.
`web.storage` does apply.

- `main` is your app's entry (`.` uses the `main` field of `package.json`) or a packaged executable. `executable`
  points at a different Electron binary if you need one.
- `build` (a [build step](configuration.md#build-steps)) builds the app before launch, when its inputs changed: for
  apps bundled with electron-vite, webpack and the like.
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

Electron opens a real window while it works, but only the page is captured, never the screen. Within a run, launches
happen one at a time, because many apps take a single-instance lock. Runs and sessions aren't kept apart: a run
started while an Electron session is open launches a second copy, which a single-instance app quits at once. Close the
session first.

## Tauri

Tauri draws its UI in the system's web view, which on macOS (WKWebView) can't be automated from outside. facetshot
offers two ways to see it.

### The UI in WebKit

This is the default. Point facetshot at your frontend, and it renders it in Playwright's WebKit, the same
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

### The real window (macOS)

For the app as users get it, with native menus and title bar, facetshot can launch the built
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
screen but `/`), and the [permissions](#permissions) below. A deep link goes to whichever copy of the app macOS has
registered for the scheme, which may be an installed copy in `/Applications` rather than the build facetshot launched;
if that happens, remove or rename the other copy while you work. The app gets the variables in
[the table below](#what-the-app-is-told), so it can size its window and choose a theme at startup.

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
It tells the app what it wants through environment variables ([below](#what-the-app-is-told)), which a few lines in
your app's debug build can follow. The app runs with a home folder of its own (`CFFIXED_USER_HOME`, under
`.facetshot/mac-home/`), so it starts from fresh settings and never touches yours.

Without a ready file, facetshot waits until two captures in a row are identical. If the app doesn't size its own
window, facetshot asks System Events to resize it, which needs the Accessibility and Automation permissions.
Screenshots are taken at the display's own scale, so on a non-Retina display a 1280×800 window gives a 1280×800
screenshot. The title bar is included.

Only one Mac app run happens at a time on a machine, since they share the screen.

What the app prints and writes to the system log is kept with each screenshot; see
[Logs](logs.md#apps-outside-the-browser).

## What the app is told

Both Tauri's real window and native Mac apps get these environment variables (and `FACETSHOT=1`), plus whatever
`desktop.env` sets. The two kinds name the window size differently:

| Variable                              | Tauri's real window | Native Mac app | Means                                                                           |
| ------------------------------------- | ------------------- | -------------- | ------------------------------------------------------------------------------- |
| `FACETSHOT_ROUTE`                     |                     | ✓              | the screen to open at launch: `/settings`, or `myapp:///settings` with a scheme |
| `FACETSHOT_WINDOW_SIZE`               |                     | ✓              | `1280x800`: size the main window's content to this                              |
| `FACETSHOT_WIDTH`, `FACETSHOT_HEIGHT` | ✓                   |                | the same, as two numbers                                                        |
| `FACETSHOT_APPEARANCE`                | ✓                   | ✓              | `light` or `dark`                                                               |
| `FACETSHOT_TEXT`                      | ✓                   | ✓              | `large`, `xlarge` or `xxl` (left out for the default size)                      |
| `FACETSHOT_LOCALE`, `LANG`            | ✓                   |                | the variant's locale                                                            |
| `TZ`                                  | ✓                   |                | the variant's time zone                                                         |
| `FACETSHOT_REDUCE_MOTION`             | ✓                   |                | `1` for a reduced-motion variant                                                |
| `FACETSHOT_READY_FILE`                | ✓                   | ✓              | write this file when the screen has finished loading (with `readyFile: true`)   |

Like builds and servers, the app gets the background helper's own environment plus these, not the environment of the
command that asked for the run.

## Steps in a Mac window

Native Mac apps and Tauri's real window take the same [steps](flows.md#steps) as a web page, in flows and in
[sessions](sessions.md), through macOS's Accessibility interface:

- A `click`, `tap` or `rightclick` on an element (`role=button[name="Save"]`, or a ref such as `e12` in a session)
  uses the element's own action, the one a screen reader would use. The pointer isn't moved and the app doesn't need
  to be in front. If the element offers no such action, or it fails (SwiftUI's context menus do), facetshot clicks it
  for real instead.
- Everything else that touches the screen is real input: a point (`@120,80`, in points from the window's top left),
  `dblclick`, `hover`, `drag`, `scroll`, and the keyboard (`fill`, `type`, `press`). The app is brought to the front
  first, and the step fails if it doesn't come to the front. A point outside the app's window is refused. Pointer
  events go to whatever is on screen at that point, so don't use the mouse while a step runs.
- `fill` focuses the field, selects its text, and types, so the app sees the same key presses a person makes.
- `menu: File>Export…` chooses from the app's menu bar.
- `press` knows the letters, digits, punctuation, arrows, Enter, Escape, Tab, Space, Backspace, Delete, Home, End and
  Page Up/Down, with Shift, Control, Alt and Meta; not the function keys.

An element is named by a ref, `role=<role>[name="…"]`, `text=…`, `label=…`, `title=…` or a point. Roles use the web's
names (`button`, `textbox`, `checkbox`, `menuitem`…). Unlike the web, `text=` and the others match the whole name
(ignoring case), not part of it. Which steps work where is in [Flows on apps](flows.md#flows-on-apps).

## Permissions

These are given in System Settings → Privacy & Security, to the app that started the
[background helper](concepts.md#the-background-helper): your terminal, your editor or your agent's app, whichever ran
facetshot first. Every later request works with that app's permissions, whoever sends it. `facetshot doctor` checks
the permissions of the app you run it from; if a run says a permission is missing although `doctor` says it is there,
`facetshot daemon stop` and run again from the app that has it.

| Permission                      | Needed for                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------- |
| Screen & System Audio Recording | screenshots of a Mac window (restart the app after allowing it)                 |
| Accessibility                   | steps and sessions in a Mac window, and resizing a window from outside          |
| Automation (System Events)      | resizing a window from outside, for apps that don't read the size they're given |

macOS asks for Automation the first time facetshot resizes a window; an app that sizes itself from
`FACETSHOT_WINDOW_SIZE` never needs it.
