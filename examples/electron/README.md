# Electron

A minimal Electron app ("Tally"): one window, two views switched by the URL hash (`#/` and `#/reports`), and a menu
bar whose View and File menus a flow can use.

Run these from this folder inside a facetshot clone, after `bun install` at the clone's root and
`bun --bun ../../src/cli.ts setup`. Elsewhere the command is `facetshot` (or `bunx facetshot`) instead of
`bun --bun ../../src/cli.ts`.

```sh
bun install
bun --bun ../../src/cli.ts app:/ app:/reports                 # both screens, two window sizes, light and dark
bun --bun ../../src/cli.ts open-reports.yaml --as dark+xxl    # a flow: click through to Reports, then a screenshot
bun --bun ../../src/cli.ts menu-export.yaml                   # a flow through the menu bar; the log has the main process's output
```

The first run downloads Electron's binary: this version of Electron fetches it the first time the `electron`
package is loaded, not at install.

How facetshot drives it (`desktop: { kind: 'electron', main: '.', navigate: 'hash' }`):

- Playwright's Electron support launches `electron .` once per variant; devices are window sizes, set with
  `BrowserWindow.setContentSize`, so one launch covers every device of a variant.
- Dark and light come from `nativeTheme.themeSource` (so native parts and the app's own `nativeTheme` listeners
  follow) and the page's media emulation; text sizes, `web.ready`, checks, flows and masks work as on the web.
- `app:/reports` sets `location.hash` to `#/reports`. Apps that route differently can use
  `navigate: 'http://localhost:5173{path}'` (a URL template) or `navigate: 'ipc:<channel>'` (emitted on `ipcMain`
  as if the window had sent it).

The window opens on screen while facetshot works; the screenshots are of the page only, never the screen.

Version: Electron 45.2.
