# Configuration reference

facetshot reads `facetshot.config.ts` (or `.mjs`, `.js`), looking upwards from the folder you run it in. Without one,
it still works with full URLs and the built-in devices and variants.

```ts
import { defineConfig } from 'facetshot';

export default defineConfig({
	// …everything below is optional
});
```

`defineConfig` only gives you types and autocompletion; the file is plain TypeScript, so you can compute values,
read environment variables or import helpers.

Paths are relative to the config file. Commands run in a shell, from their `cwd` (relative to the config) or the
config's folder. Commands and environment values can use placeholders such as `{port}` and `{services.api.url}`;
[Placeholders](auth-and-data.md#placeholders) lists them and when each one is available.

## Settings that differ per checkout or per person

The config is code, so it can read environment variables. It is always evaluated with the environment of whoever
asked for the screenshots, even when the background helper runs it, so a teammate or an agent can choose another
database or server without editing the file:

```ts
const database = process.env.SHOTS_DB ?? 'app_dev';
```

Commands and apps facetshot starts (builds, servers, Electron, Mac and Tauri apps) don't inherit that environment:
they get the background helper's own environment plus their `env`. The helper's own environment is that of whatever
started it first (your terminal, or an agent's MCP server). Read a variable in the config and pass it in `env` when a
command needs it. This section is the one place that describes it; other pages link here.

When several checkouts of one project take screenshots at once (agents in separate git worktrees, say), give each
its own ports with `stablePorts`. Each checkout gets a block of ports the first time and keeps it from then on, which
helps when a port ends up inside a build (an API address in the web bundle). A removed checkout gives its block
back. Blocks come from 5400–5999 unless you pass `{ from, to }`, and are kept in `~/.facetshot/ports.json`.

```ts
import { defineConfig, stablePorts } from 'facetshot';

const [webPort, apiPort] = stablePorts(import.meta.dirname, 2);
```

[A complete example](auth-and-data.md#a-complete-example-web-app-and-api) uses these ports for a web app and its
API.

With `stablePorts`, checkouts never share or stop each other's servers. Runs from the same checkout share one set,
through the background helper.

## Top level

| Key         | Type                             | Default                         |                                                                                                                                                     |
| ----------- | -------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `out`       | string                           | `.facetshot`                    | where runs, logs, build stamps and baselines go                                                                                                     |
| `devices`   | object                           |                                 | add or change devices (below)                                                                                                                       |
| `groups`    | `{ name: string[] }`             |                                 | name several devices                                                                                                                                |
| `variants`  | object                           |                                 | add or change variants (below)                                                                                                                      |
| `profiles`  | `{ name: { targets?, on, as } }` | `default`: review × light, dark | devices and variants to use when the command doesn't say, and with `targets`, what to take when it names nothing ([Profiles](concepts.md#profiles)) |
| `aliases`   | `{ name: target }`               |                                 | short names for targets                                                                                                                             |
| `checks`    | string[]                         | `['console', 'network']`        | checks run while taking screenshots ([Checks](checks.md))                                                                                           |
| `services`  | object                           |                                 | servers your app needs (below)                                                                                                                      |
| `fixtures`  | object                           |                                 | test data (below)                                                                                                                                   |
| `web`       | object                           |                                 | web pages (below)                                                                                                                                   |
| `storybook` | object                           |                                 | [Storybook](storybook.md) (below)                                                                                                                   |
| `desktop`   | object                           |                                 | [Electron, Tauri or a Mac app](desktop.md) (below)                                                                                                  |
| `apple`     | object                           |                                 | [iOS simulator and Mac builds](ios.md) (below)                                                                                                      |
| `swift`     | object                           |                                 | [SwiftUI snapshots](swiftui.md) (below)                                                                                                             |
| `limits`    | object                           |                                 | how much runs at once (below)                                                                                                                       |

## Build steps

`web.build`, `desktop.build`, `apple.ios.build` and the others are build steps:

| Field    |                                                                                           |
| -------- | ----------------------------------------------------------------------------------------- |
| `cmd`    | the command, run in a shell                                                               |
| `inputs` | files and folders whose contents decide whether a rebuild is needed                       |
| `output` | what the build makes; if it is missing, the build runs again                              |
| `cwd`    | the folder to run it in (default: the config's)                                           |
| `env`    | environment for the command                                                               |
| `heavy`  | a heavy build (Xcode, a large bundle): only one heavy build runs on the machine at a time |

## `devices`

Each key is a device name. Start from a built-in device with `extends`, or define one from scratch:

```ts
devices: {
	'desktop-wide': { extends: 'desktop', width: 1920, height: 1080 },
	'kiosk': { platform: 'web', width: 1080, height: 1920, scale: 1, touch: true },
	iphone: { extends: 'iphone', model: 'iPhone 17' }
}
```

| Field                          | For            |                                                                                                 |
| ------------------------------ | -------------- | ----------------------------------------------------------------------------------------------- |
| `platform`                     | all            | `web`, `ios` or `window`                                                                        |
| `width`, `height`              | all            | size in CSS pixels or points                                                                    |
| `scale`                        | all            | pixel density (default 2)                                                                       |
| `mobile`, `touch`, `userAgent` | web            | phone browser behaviour                                                                         |
| `model`                        | ios            | simulator device type, as Xcode names it                                                        |
| `orientation`                  | ios            | `portrait` or `landscape`                                                                       |
| `split`                        | ios            | width as a fraction of the screen, for Split View (the app is told the width)                   |
| `idiom`, `safeArea`            | ios, snapshots | the device family (`phone`, `pad`, `mac`) and screen insets a snapshot renderer assumes         |
| `label`                        | all            | a friendlier name                                                                               |
| `extends`                      | all            | a built-in device to start from; the other fields change it                                     |
| `browser`                      | web            | the browser for this device: `chromium`, `webkit`, `firefox`, `chrome`, `msedge`, `moz-firefox` |

## `variants`

Each key is a variant name; each field is one axis. Unset fields keep the platform's default.

```ts
variants: {
	night: { appearance: 'dark' },
	'ko-large': { locale: 'ko-KR', text: 'large' },
	'as-admin': { persona: 'admin' }
}
```

| Field        | Values                                         |
| ------------ | ---------------------------------------------- |
| `appearance` | `light`, `dark`                                |
| `text`       | `default`, `large`, `xlarge`, `xxl`            |
| `contrast`   | `more`, `forced`                               |
| `motion`     | `reduce` (the default for screenshots), `full` |
| `locale`     | a BCP 47 tag, e.g. `de-DE`                     |
| `timezone`   | an IANA zone, e.g. `Asia/Seoul`                |
| `direction`  | `ltr`, `rtl`                                   |
| `persona`    | a name from `web.personas`                     |
| `network`    | `offline`                                      |
| `media`      | `print`                                        |

## `web`

| Key                   |                                                                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseURL`             | where your app runs, if you start it yourself                                                                                                                                                                                                                     |
| `build`               | `{ cmd, inputs, output?, cwd?, env?, heavy? }`: a build that runs when `inputs` change                                                                                                                                                                            |
| `serve`               | `{ cmd, port?, health?, reuse?, cwd?, env?, startTimeout? }`: the server for the app. Leave it out when `build.output` is a folder of static files (a single-page app, Flutter's `build/web`): facetshot serves it, with `index.html` for paths that aren't files |
| `browser`             | the default browser: `chromium` (default), `webkit`, `firefox`, `chrome`, `msedge`, `moz-firefox`                                                                                                                                                                 |
| `personas`, `persona` | who is signed in (below)                                                                                                                                                                                                                                          |
| `storage`             | `localStorage` entries set before the page loads                                                                                                                                                                                                                  |
| `ready`               | `{ idle?, visible?, gone?, when?, timeout?, routes? }` ([Web apps](web.md#when-a-page-counts-as-ready))                                                                                                                                                           |
| `block`               | URL globs to abort                                                                                                                                                                                                                                                |
| `rewrite`             | `[{ from, to }]`: URL prefixes to send elsewhere                                                                                                                                                                                                                  |
| `mask`                | selectors painted over in screenshots                                                                                                                                                                                                                             |
| `css`                 | CSS added to every page                                                                                                                                                                                                                                           |
| `textSizes`           | root font sizes for `large`, `xlarge`, `xxl` (default 125%, 150%, 200%)                                                                                                                                                                                           |
| `clock`               | freeze the page's clock at this time (ISO 8601)                                                                                                                                                                                                                   |
| `fullPage`            | take the whole page instead of the screen (default false)                                                                                                                                                                                                         |

Steps in a persona's `login` flow hold their text as written; see [Steps](flows.md#steps).

### `web.personas`

Each key names a persona. See [Personas](auth-and-data.md#personas) for how each field behaves.

| Field          |                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------- |
| `cookies`      | `[{ name, value, domain?, path? }]`; `domain` defaults to the app's host name, `path` to `/` |
| `headers`      | request headers sent with every request, including requests to other sites                   |
| `storage`      | `localStorage` entries                                                                       |
| `storageState` | a Playwright storage state file; used instead of `login` when both are given                 |
| `login`        | a flow that signs in; its result is saved in `.facetshot/auth/`                              |
| `ttl`          | minutes a `login` result is reused (default 720)                                             |

## `services`

Each key names a service; see [Services](auth-and-data.md#services).

| Field               |                                                       |
| ------------------- | ----------------------------------------------------- |
| `cmd`, `cwd`, `env` | how to start it                                       |
| `port`              | a number, or `auto` for a free one                    |
| `health`            | a path or URL that answers 2xx when it's ready        |
| `reuse`             | if this URL answers already, use it and start nothing |
| `startTimeout`      | milliseconds to wait for `health` (default 120 000)   |

## `desktop`

One app per project. See [Desktop apps](desktop.md).

| Field        | For                    |                                                                                                  |
| ------------ | ---------------------- | ------------------------------------------------------------------------------------------------ |
| `kind`       | all                    | `electron`, `tauri` or `macos`                                                                   |
| `main`       | electron               | the app's entry (`.` for `package.json`'s `main`) or a packaged executable                       |
| `executable` | electron               | another Electron binary                                                                          |
| `app`        | tauri, macos           | a built `.app`, or leave it out and give `build` with an `output`                                |
| `build`      | all                    | a [build step](#build-steps) run before launch when its inputs change                            |
| `navigate`   | all                    | how `app:/path` is reached: `hash`, a URL with `{path}`, `ipc:<channel>` (Electron), or a scheme |
| `args`       | all                    | launch arguments                                                                                 |
| `env`        | all                    | environment for the app; placeholders are filled                                                 |
| `readyFile`  | tauri, macos           | the app writes `FACETSHOT_READY_FILE` when a screen has settled                                  |
| `engine`     | tauri                  | `webkit` (the UI in WebKit, the default with `frontend`) or `window` (the real window)           |
| `frontend`   | tauri                  | the web UI: `url`, or `cmd`, `port`, `health` and an optional `build`                            |
| `invoke`     | tauri, `webkit` engine | answers for `invoke()` calls                                                                     |

## `apple`

For an app that runs on the iOS simulator, and optionally its Mac build. See [iOS simulators](ios.md).

| Field           |                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `bundleId`      | the app's bundle identifier (required)                                                             |
| `scheme`        | the URL scheme deep links use, such as `myapp`                                                     |
| `deepLinkStyle` | `path` (`myapp:///settings`, the default) or `host` (`myapp://settings`)                           |
| `ios`, `macos`  | `{ app }` (a built `.app`) or `{ build }` (a [build step](#build-steps) whose `output` is the app) |
| `env`, `args`   | environment and launch arguments for the app                                                       |
| `readyFile`     | the app writes `FACETSHOT_READY_FILE` when a screen has settled                                    |
| `variantEnv`    | environment that tells the app which variant to show ([Variants on iOS](ios.md#variants-on-ios))   |

## `swift`

See [SwiftUI scenes](swiftui.md).

| Field     |                                                                       |
| --------- | --------------------------------------------------------------------- |
| `package` | the Swift package or Xcode project folder                             |
| `test`    | the test that draws the scenes, `Target/Test`                         |
| `scheme`  | the xcodebuild scheme for iOS runs (default `<package name>-Package`) |
| `inputs`  | folders whose change rebuilds the test bundle (default: the package)  |

## `storybook`

See [Storybook](storybook.md).

| Field     |                                                                                        |
| --------- | -------------------------------------------------------------------------------------- |
| `url`     | a Storybook that is already running                                                    |
| `build`   | a [build step](#build-steps) whose `output` is a static Storybook, served by facetshot |
| `ready`   | readiness for stories, with `routes` keyed by story id globs                           |
| `globals` | Storybook globals to set per variant, for decorators that switch themes themselves     |

## `fixtures`

| Field               |                                                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup(ctx)`        | a function that makes test data and returns `{ name: value }` (strings) for placeholders. `ctx` has `runId`, `label`, `services`, `record(kind, id, extra?)` and `log` ([Test data](auth-and-data.md#test-data)) |
| `remove(item, ctx)` | removes one recorded item: `{ kind, id, extra }`                                                                                                                                                                 |
| `reuse`             | keep the data while the background helper is up (default true)                                                                                                                                                   |

## `limits`

| Field        | Default                                                 |                                                                                                                |
| ------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `webPages`   | 4                                                       | browser pages being worked at once, across all web devices; never more than 4                                  |
| `simulators` | 2                                                       | simulators booted at once; never more than 2                                                                   |
| `maxLoad`    | 3                                                       | with `--no-daemon` only: above this many times the core count (1-minute load average), work goes one at a time |
| `lockDir`    | `~/.facetshot/locks`                                    | where machine-wide locks live                                                                                  |
| `lockNames`  | `{ build: 'build.lock', macWindow: 'mac-window.lock' }` | lock names, to share locks with your own scripts                                                               |

A project can lower these limits for itself but not raise them. How they are shared across runs, and the load brake
(work slows down when the machine is busy), are described in [Shared limits](architecture.md#shared-limits).

Locks are folders created with `mkdir`, so shell scripts can take the same ones: `mkdir build.lock` before a build,
`rmdir build.lock` after. Point `lockDir` and `lockNames` at the locks your team's scripts already use, and facetshot
takes its turn with them. Heavy builds share the `build` lock, so only one runs at a time.
