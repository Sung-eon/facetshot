# Tauri 2

A minimal Tauri 2 app ("Pebble") with a Vite frontend: two screens (`/` and `/about`), a Rust `greet` command, and
the deep-link plugin registering the `pebble://` scheme.

```sh
bun install
bun --bun ../../src/cli.ts app:/ app:/about
```

On macOS a Tauri window is a WKWebView, which nothing outside the app can automate. So facetshot has two ways in:

- **`webkit`** (what this config does, because `desktop.frontend` is set): the frontend is built (`vite build`),
  served (`vite preview`) and opened in Playwright's WebKit at each window size — the same engine family as the app,
  with readiness, checks, flows and masks. There's no Rust in a browser, so `invoke('greet')` is answered from
  `desktop.invoke` in the config; any other command rejects with an error naming it. Playwright's WebKit is a recent
  WebKit build, not the exact one in your macOS.
- **`window`** (`desktop.engine: 'window'`, macOS): the real app, built with `tauri build --bundles app` (needs Rust:
  `rustup`), launched, sent to each screen with `open pebble://about`, and its window captured. The app can't be
  resized or re-themed from outside, so facetshot passes `FACETSHOT_WIDTH`, `FACETSHOT_HEIGHT` and
  `FACETSHOT_APPEARANCE` in its environment; `src-tauri/src/lib.rs` shows the dozen lines that honour them. Run
  `bun tauri icon <a 1024×1024 png>` once first: a bundle needs icons. _This path was written but not yet run here:
  there was no Rust toolchain on the machine it was made on._

Windows (WebView2 over the DevTools protocol) and Linux (WebKitGTK through `tauri-driver`) aren't supported yet;
facetshot says so when asked, and the `webkit` engine works on every system.

Versions: Tauri 2.12 (`tauri` crate 2.12, `@tauri-apps/cli` 2.12), deep-link plugin 2.6, Vite 8.3.
