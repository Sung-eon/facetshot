# How it works

A few ideas explain everything facetshot does.

## Targets, devices and variants

Every picture is one **target** on one **device** in one **variant**.

- A **target** is _what_ you want to see: a web path, an app screen, a Storybook story, a SwiftUI view, or a flow
  (a few clicks and keystrokes that end in a picture). You tell facetshot which kind by how you write it:

  | Written as                        | Kind                                                              |
  | --------------------------------- | ----------------------------------------------------------------- |
  | `/path`, `https://…`              | web page                                                          |
  | `app:/path`                       | app screen (iOS simulator or desktop window), opened by deep link |
  | `story:id`, `story:Title/*`       | Storybook story                                                   |
  | `preview:Name`, `preview:Group/*` | SwiftUI scene                                                     |
  | `flows/name.yaml`                 | flow                                                              |

  You can also give targets short names in your config (`aliases: { cart: '/shop/cart' }`).

- A **device** is _where_: a browser window of a certain size, a simulator, or a desktop window size. The built-in
  ones are below; your config can add more.

  | Name                                           | What                                                            |
  | ---------------------------------------------- | --------------------------------------------------------------- |
  | `desktop`                                      | browser, 1440×900                                               |
  | `laptop`                                       | browser, 1280×800                                               |
  | `tablet-landscape`, `tablet-portrait`          | browser, 1180×820 and 820×1180, touch                           |
  | `phone`, `phone-small`                         | mobile browser, 390×844 and 360×740                             |
  | `iphone`                                       | iPhone simulator                                                |
  | `ipad-portrait`, `ipad-landscape`, `ipad-half` | iPad simulator, both ways up and in half of Split View          |
  | `window`, `window-small`, `mac`, `mac-narrow`  | a desktop app's window at 1280×800, 960×640, 1280×800, 1040×640 |

  **Groups** name several devices at once: `review` (desktop, both tablets, phone), `web`, `ios`, `apple`, `windows`.

- A **variant** is _how_: light or dark, larger text, more contrast, right-to-left, offline, a different signed-in
  person. Built in: `light`, `dark`, `large`, `xlarge`, `xxl`, `contrast`, `forced`, `rtl`, `offline`, `print`.
  Join variants with `+` to combine them: `dark+large`. Groups: `modes` (light, dark, large) and `a11y` (light, dark,
  xxl, contrast).

facetshot takes every target on every device that can show it, in every variant. A web page isn't taken on an iPhone
simulator, and an `app:` screen isn't taken in a browser; if nothing you asked for can show a target, the summary says
so instead of skipping it quietly.

## Profiles

A **profile** is a named choice of devices and variants, so you don't have to repeat `--on` and `--as`. `default` is
used when you pass neither; pick another with `-p`:

```ts
profiles: {
	default: { on: ['review'], as: ['light', 'dark'] },
	full: { on: ['review'], as: ['light', 'dark', 'large'] },
	app: { on: ['iphone', 'ipad-landscape'], as: ['light', 'dark'] }
}
```

```sh
facetshot /settings -p full
```

## What a run gives you

Each run gets a folder, `.facetshot/runs/<run id>/`, and `.facetshot/latest` always points at the newest one.

- **Contact sheets** — `<screen>.sheet.jpg`, one per screen: devices down, variants across. A cell that failed shows
  why; a cell with problems carries a badge; a cell that changed since the run you compared with has a red outline.
- **Pictures** — `<screen>/<device>.<variant>.png`, at the device's real pixel density.
- **`manifest.json`** — every picture's status, timing, problems found and (when comparing) how much changed. The
  format is described by [`schema/manifest.v1.json`](../schema/manifest.v1.json).
- **`report.html`** — the run for people: every screen as a grid of its pictures (click for full size), what the
  checks found next to it, and a switch to show changed pixels. Open it with `--open`, or straight from the folder.
- **`summary.md`** — the summary as Markdown with the sheets as images, ready to paste into a pull request or issue.

The last 20 runs are kept. To keep one for good, save it as a [baseline](comparing.md).

## The background helper

The first time you run facetshot it starts a small background process (the _daemon_). The daemon keeps the browser,
your app's servers, simulators and test data ready between runs, which is most of why the second run is fast. Every
run on the machine goes through it — from your terminal, from agents, from MCP — so they share one browser and the
machine-wide limits.

You never need to manage it. It stops by itself after 15 minutes without work, and closes everything it started when
it does. If you want to see or stop it:

```sh
facetshot daemon status
facetshot daemon stop
```

Pass `--no-daemon` to do everything in the current process instead (slower the next time, but self-contained), for
example in CI.

## Getting ready, once

Before the first picture, facetshot gets things ready, in this order, and reuses each piece while it's still valid:

1. **Services** your app needs (an API, a database proxy) start, unless something healthy already answers there.
2. **Test data** is made by your config's `fixtures.setup`, and its ids fill `{placeholders}` in targets.
3. **Builds** run if their inputs changed since the last build.
4. **Servers, browsers and simulators** start.

Everything facetshot starts, it also stops. Test data is recorded as it's made, so even if a run is killed halfway,
the next run removes what was left behind.
