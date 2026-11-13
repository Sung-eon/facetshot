# Tauri 2

A minimal Tauri 2 app ("Pebble") with a Vite frontend: two screens (`/` and `/about`), a Rust `greet` command, and
the deep-link plugin registering the `pebble://` scheme.

Run these from this folder inside a facetshot clone, after `bun install` at the clone's root and
`bun --bun ../../src/cli.ts setup`. Elsewhere the command is `facetshot` (or `bunx facetshot`) instead of
`bun --bun ../../src/cli.ts`. The `webkit` way below also needs
`bun --bun ../../src/cli.ts setup --browser webkit`.

```sh
bun install
bun --bun ../../src/cli.ts app:/ app:/about
```

On macOS a Tauri window is a WKWebView, which nothing outside the app can automate. So facetshot has two ways in:

- **`webkit`** (what this config does, because `desktop.frontend` is set): the frontend is built (`vite build`),
  served (`vite preview`) and opened in Playwright's WebKit at each window size (the same engine family as the app),
  with readiness, checks, flows and masks. There's no Rust in a browser, so `invoke('greet')` is answered from
  `desktop.invoke` in the config; any other command rejects with an error naming it. Playwright's WebKit is a recent
  WebKit build, not the exact one in your macOS.
- **`window`** (`desktop.engine: 'window'`, macOS): the real app, built with `tauri build --bundles app` (needs
  Rust), launched, sent to each screen with `open pebble://about`, and its window captured. Flows take every step a
  Mac window takes, and what `greet` prints (`println!`) is in the logs. The app can't be resized or re-themed from
  outside, so facetshot tells it what it wants in its environment
  ([the variables](../../docs/desktop.md#what-the-app-is-told)); `src-tauri/src/lib.rs` shows the dozen lines that
  honour the size and theme. See [Status and limits](../../docs/status.md) for how far this path has been tried.

Windows (WebView2 over the DevTools protocol) and Linux (WebKitGTK through `tauri-driver`) aren't supported yet;
facetshot says so when asked, and the `webkit` engine works on every system.

Versions: Tauri 2.12 (`tauri` crate 2.12, `@tauri-apps/cli` 2.12), deep-link plugin 2.6, Vite 8.3.
