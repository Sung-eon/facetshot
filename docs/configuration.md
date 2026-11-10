# Configuration reference

facetshot reads `facetshot.config.ts` (or `.mjs`, `.js`), looking upwards from the folder you run it in. Without one,
it still works on full URLs with the built-in devices and variants.

```ts
import { defineConfig } from 'facetshot';

export default defineConfig({
	// …everything below is optional
});
```

`defineConfig` only gives you types and autocompletion; the file is plain TypeScript, so you can compute values,
read environment variables or import helpers.

Paths are relative to the config file. Commands run in a shell, from `cwd` (relative to the config) or the config's
folder. In commands and environment values, these placeholders are filled in:

| Placeholder                            | Is                                         |
| -------------------------------------- | ------------------------------------------ |
| `{port}`                               | the port chosen for this service or server |
| `{url}`                                | its address, `http://localhost:{port}`     |
| `{services.<name>.url}`                | another service's address                  |
| `{web.url}`                            | where the web app is being served          |
| any name your `fixtures.setup` returns | e.g. `{project}`                           |

## Settings that differ per checkout or per person

The config is code, so it can read environment variables — and it is always read in the environment of whoever
asked for the pictures, even when the background helper runs it. A teammate or an agent can pick another database
or server without editing the file:

```ts
const database = process.env.SHOTS_DB ?? 'app_dev';
```

When several checkouts of one project take pictures at once (agents in separate git worktrees, say), give each its
own ports with `stablePorts`. Each checkout gets a block of ports the first time and keeps it from then on, which
matters when a port ends up inside a build (an API address in the web bundle). A removed checkout gives its block
back. Blocks come from 5400–5999 unless you pass `{ from, to }`, and are kept in `~/.facetshot/ports.json`.

```ts
import { defineConfig, stablePorts } from 'facetshot';

const [webPort, apiPort] = stablePorts(import.meta.dirname, 2);

export default defineConfig({
	services: {
		api: { cmd: 'npm run api', port: apiPort, env: { CORS_ORIGIN: `http://localhost:${webPort}` } }
	},
	web: {
		build: { cmd: 'vite build', inputs: ['src'], env: { VITE_API: `http://localhost:${apiPort}` } },
		serve: { cmd: `vite preview --port ${webPort} --strictPort`, port: webPort }
	}
});
```

Checkouts then never share or stop each other's servers. Runs from the same checkout share one set, through the
background helper.

## Top level

| Key         | Type                   | Default                         |                                                                    |
| ----------- | ---------------------- | ------------------------------- | ------------------------------------------------------------------ |
| `out`       | string                 | `.facetshot`                    | where runs, logs, build stamps and baselines go                    |
| `devices`   | object                 |                                 | add or change devices (below)                                      |
| `groups`    | `{ name: string[] }`   |                                 | name several devices                                               |
| `variants`  | object                 |                                 | add or change variants (below)                                     |
| `profiles`  | `{ name: { on, as } }` | `default`: review × light, dark | devices and variants to use when the command doesn't say           |
| `aliases`   | `{ name: target }`     |                                 | short names for targets                                            |
| `checks`    | string[]               | `['console', 'network']`        | checks run while taking pictures                                   |
| `services`  | object                 |                                 | servers your app needs ([Web apps](web.md#servers-your-app-needs)) |
| `fixtures`  | object                 |                                 | test data ([Web apps](web.md#test-data))                           |
| `web`       | object                 |                                 | web pages (below)                                                  |
| `storybook` | object                 |                                 | [Storybook](storybook.md)                                          |
| `desktop`   | object                 |                                 | [Electron, Tauri or a Mac app](desktop.md)                         |
| `apple`     | object                 |                                 | [iOS simulator and Mac builds](ios.md)                             |
| `swift`     | object                 |                                 | [SwiftUI snapshots](swiftui.md)                                    |
| `limits`    | object                 |                                 | how much runs at once (below)                                      |

## `devices`

Each key is a device name. Start from a built-in device with `extends`, or define one from scratch:

```ts
devices: {
	'desktop-wide': { extends: 'desktop', width: 1920, height: 1080 },
	'kiosk': { platform: 'web', width: 1080, height: 1920, scale: 1, touch: true },
	iphone: { extends: 'iphone', model: 'iPhone 17' }
}
```

| Field                          | For            |                                                                               |
| ------------------------------ | -------------- | ----------------------------------------------------------------------------- |
| `platform`                     | all            | `web`, `ios` or `window`                                                      |
| `width`, `height`              | all            | size in CSS pixels or points                                                  |
| `scale`                        | all            | pixel density (default 2)                                                     |
| `mobile`, `touch`, `userAgent` | web            | phone browser behaviour                                                       |
| `model`                        | ios            | simulator device type, as Xcode names it                                      |
| `orientation`                  | ios            | `portrait` or `landscape`                                                     |
| `split`                        | ios            | width as a fraction of the screen, for Split View (the app is told the width) |
| `idiom`, `safeArea`            | ios, snapshots | what a snapshot renderer assumes                                              |
| `label`                        | all            | a friendlier name                                                             |

## `variants`

Each key is a variant name; each field is one axis. Unset fields keep the platform's default.

```ts
variants: {
	night: { appearance: 'dark' },
	'ko-large': { locale: 'ko-KR', text: 'large' },
	'as-admin': { persona: 'admin' }
}
```

| Field        | Values                                      |
| ------------ | ------------------------------------------- |
| `appearance` | `light`, `dark`                             |
| `text`       | `default`, `large`, `xlarge`, `xxl`         |
| `contrast`   | `more`, `forced`                            |
| `motion`     | `reduce` (the default for pictures), `full` |
| `locale`     | a BCP 47 tag, e.g. `de-DE`                  |
| `timezone`   | an IANA zone, e.g. `Asia/Seoul`             |
| `direction`  | `ltr`, `rtl`                                |
| `persona`    | a name from `web.personas`                  |
| `network`    | `offline`                                   |
| `media`      | `print`                                     |

## `web`

| Key                   |                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `baseURL`             | where your app runs, if you start it yourself                                                           |
| `build`               | `{ cmd, inputs, output?, cwd?, env?, heavy? }`: a build that runs when `inputs` change                  |
| `serve`               | `{ cmd, port?, health?, reuse?, cwd?, env?, startTimeout? }`: the server for the app                    |
| `browser`             | `chromium` (default), `webkit`, `firefox`                                                               |
| `personas`, `persona` | who is signed in ([Web apps](web.md#who-is-signed-in))                                                  |
| `storage`             | `localStorage` entries set before the page loads                                                        |
| `ready`               | `{ idle?, visible?, gone?, when?, timeout?, routes? }` ([Web apps](web.md#when-a-page-counts-as-ready)) |
| `block`               | URL globs to abort                                                                                      |
| `rewrite`             | `[{ from, to }]`: URL prefixes to send elsewhere                                                        |
| `mask`                | selectors painted over in pictures                                                                      |
| `css`                 | CSS added to every page                                                                                 |
| `textSizes`           | root font sizes for `large`, `xlarge`, `xxl` (default 125%, 150%, 200%)                                 |
| `clock`               | freeze the page's clock at this time (ISO 8601)                                                         |
| `fullPage`            | take the whole page instead of the screen (default false)                                               |

## `services`

Each key names a service; see [Web apps](web.md#servers-your-app-needs).

| Field               |                                                       |
| ------------------- | ----------------------------------------------------- |
| `cmd`, `cwd`, `env` | how to start it                                       |
| `port`              | a number, or `auto` for a free one                    |
| `health`            | a path or URL that answers 2xx when it's ready        |
| `reuse`             | if this URL answers already, use it and start nothing |
| `startTimeout`      | milliseconds to wait for `health` (default 120 000)   |

## `fixtures`

| Field               |                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `setup(ctx)`        | makes test data; returns `{ name: value }` for placeholders. `ctx.label`, `ctx.record(kind, id, extra?)`, `ctx.services`, `ctx.log` |
| `remove(item, ctx)` | removes one recorded item: `{ kind, id, extra }`                                                                                    |
| `reuse`             | keep the data while the background helper is up (default true)                                                                      |

## `limits`

| Field        | Default                                                 |                                                                                       |
| ------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `webPages`   | 4                                                       | browser pages at once, across all web devices; never more than the machine's 4        |
| `simulators` | 2                                                       | simulators booted at once; never more than the machine's 2                            |
| `maxLoad`    | 3                                                       | above this many times the core count (1-minute load average), work goes one at a time |
| `lockDir`    | `~/.facetshot/locks`                                    | where machine-wide locks live                                                         |
| `lockNames`  | `{ build: 'build.lock', macWindow: 'mac-window.lock' }` | lock names, to share locks with your own scripts                                      |

Locks are folders created with `mkdir`, so shell scripts can take the same ones: `mkdir build.lock` before a build,
`rmdir build.lock` after. Point `lockDir` and `lockNames` at the locks your team's scripts already use, and facetshot
takes its turn with them. Heavy builds run one at a time on the machine: they share the `build` lock. See [Speed and machine safety](performance.md).
