# facetshot

**See every screen of your app on every device, in light, dark and large text — in one command.**

facetshot takes pictures of your web pages, iOS and Mac screens, Electron and Tauri windows, Storybook stories and
SwiftUI views across a grid of devices and display settings, and gives you back one contact sheet per screen plus a
short list of what looks broken. It was built for AI coding agents, which need to _see_ a UI change before they can
honestly say it's done — but it works just as well from your own terminal.

```
$ facetshot /pricing /checkout
24/24 pictures · 2 screens · 4 devices × 3 variants · 9.8s (0.4s getting ready)

Sheets:
  .facetshot/latest/pricing.sheet.jpg
  .facetshot/latest/checkout.sheet.jpg

Found (2):
  ✗ checkout [phone/light, phone/dark] overflow: The page is 48px wider than the screen, so it scrolls sideways. — form.payment > div.row
  ! pricing [4 cells] clipped: Text cut sideways. "Everything in Pro, plus priority support" — li.feature
```

Each sheet is a grid — devices down the side, variants across the top — so one image shows you how a screen holds up
everywhere:

|             | light | dark | large |
| ----------- | ----- | ---- | ----- |
| **desktop** | ▢     | ▢    | ▢     |
| **tablet**  | ▢     | ▢    | ▢     |
| **phone**   | ▢     | ▢    | ▢     |

## Why it exists

Checking a UI change properly means looking at it on a phone, a tablet and a desktop, in light and dark mode, with
large text — that's a dozen pictures per screen. Doing it by hand is tedious; scripting it is worse: every script
re-solves logging in, test data, waiting for the page to finish loading, and starting the right servers, and most of
the time goes into getting ready rather than looking.

facetshot does the getting ready once and keeps it ready:

- **It keeps things warm.** A small background helper holds the browser, your app's server and any simulators between
  runs, so the second look takes seconds, not minutes.
- **It waits for the screen, not the clock.** Pictures are taken when the network is quiet, fonts are loaded and
  spinners are gone — never after a fixed sleep.
- **It reads the screen for you.** Alongside the pictures it checks for sideways scrolling, cut-off text, buttons
  something else covers, broken images, console errors and failed requests, so you know which picture to look at.
- **It's safe to run a lot of.** Ten agents taking pictures at once still share one browser, two simulators and one
  build at a time, and slow down when the machine is busy instead of piling on.

## Quick start

You need [Bun](https://bun.sh) 1.3+ (or Node 22.6+) and macOS, Linux or Windows for web pages; Apple targets need a
Mac with Xcode.

```sh
npm i -D facetshot              # or: bun add -d facetshot
npx playwright install chromium
npx facetshot https://example.com --on phone,desktop
```

That works on any URL with no setup. For your own app, let facetshot write a starter config from what your project
already uses (Vite, SvelteKit, Next.js, Astro, Storybook, Electron, Tauri, Swift packages):

```sh
npx facetshot init
npx facetshot /                 # your home page, on the default devices and variants
```

Then connect your coding agent so it can use facetshot by itself:

```sh
npx facetshot init --agent claude    # or cursor, codex, all
```

This registers facetshot's MCP server and adds a short skill that teaches the agent when and how to look.

## What you can point it at

| Write                                     | To see                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `/settings` or `https://…`                | a web page                                                                    |
| `app:/inbox`                              | an app screen, opened by deep link on an iOS simulator or in a desktop window |
| `story:button--primary`, `story:Button/*` | Storybook stories                                                             |
| `preview:Settings/Account`                | SwiftUI views rendered without launching the app                              |
| `flows/delete-account.yaml`               | a state you reach by clicking and typing                                      |

Choose devices with `--on` and display settings with `--as`, and click or type your way to a state first with `--do`:

```sh
facetshot /settings --on phone,tablet-portrait --as light,dark,dark+large
facetshot /settings --do "click:text=Delete account" --do shot:confirm
```

Each run leaves a `report.html` with every picture on one page (`--open` opens it), a Markdown summary for pull
requests (`--format md`), and a `manifest.json` for scripts (`--format json`).

## Documentation

- [Getting started](docs/getting-started.md) — install, the first picture, your first config
- [How it works](docs/concepts.md) — targets, devices, variants, profiles, runs and the background helper
- [Web apps](docs/web.md) — builds and servers, signing in, test data, when a screen counts as ready
- [Flows](docs/flows.md) — pictures of menus, dialogs and half-filled forms
- [Checks](docs/checks.md) — what facetshot reads on each screen
- [Comparing](docs/comparing.md) — what changed since the last run or a saved baseline
- [iOS simulators](docs/ios.md) and [SwiftUI snapshots](docs/swiftui.md)
- [Desktop apps](docs/desktop.md) — native Mac apps, Electron and Tauri
- [Storybook](docs/storybook.md)
- [AI agents](docs/agents.md) — the MCP server, the skill, and using facetshot well from an agent
- [Configuration reference](docs/configuration.md)
- [Command reference](docs/cli.md)
- [Speed and machine safety](docs/performance.md)
- [Troubleshooting](docs/troubleshooting.md)

## Platform support

|                                       | macOS                            | Linux   | Windows |
| ------------------------------------- | -------------------------------- | ------- | ------- |
| Web pages (Chromium, WebKit, Firefox) | ✓                                | ✓       | ✓       |
| Storybook                             | ✓                                | ✓       | ✓       |
| Electron                              | ✓                                | ✓       | ✓       |
| iOS simulator                         | ✓                                | —       | —       |
| SwiftUI snapshots                     | ✓                                | —       | —       |
| Native Mac windows                    | ✓                                | —       | —       |
| Tauri                                 | ✓ (window, and the UI in WebKit) | planned | planned |
| Android                               | planned                          | planned | planned |

Everything marked ✓ is tested on macOS. Web, Storybook and Electron use only Playwright, which runs the same way on
Linux and Windows, but haven't been tried there yet — reports welcome.

## License

MIT
