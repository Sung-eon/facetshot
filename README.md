<p align="center">
  <img src="docs/images/hero.svg" alt="facetshot: one command takes screenshots of a page on desktop, tablet and phone in light, dark and large text, and lists what looks broken, with the logs." width="100%">
</p>

# facetshot

facetshot takes screenshots of your app's screens on several devices and in several display settings at once (light,
dark, large text and more). It puts them side by side in one image per screen, a _contact sheet_: each row is a device
and each column a setting. It keeps the page's log (console messages, failed requests) and the output of any servers
it started for you, and `facetshot check` reads each screen for common problems, such as horizontal scrolling or text
cut off by its box.

It works with web pages, Storybook stories, Electron and Tauri windows, iOS simulators, native Mac apps, Flutter apps
and SwiftUI views. Beyond screenshots, it can click, type and open menus in those screens, step by step or from a
saved list of steps. It is made for AI coding agents as well as for people: it has a command line, an
[MCP](docs/concepts.md#glossary) server and an [Agent Skill](docs/concepts.md#glossary). It uses
[Playwright](https://playwright.dev), a browser-automation library, to drive browsers.

> **Status: early (0.1).** The config format may change before 1.0. It is tested on
> macOS; web pages should work on Linux and Windows, but nobody has tried them there yet. See
> [Status and limits](docs/status.md).

## First run

1. Install [Bun](https://bun.sh) 1.3 or newer. facetshot runs on Bun whatever your app is built with.

2. Install facetshot in your project, then the browser it uses (Chromium, about 600 MB):

   ```sh
   bun add -d facetshot
   bunx playwright install chromium
   ```

3. Take screenshots of any public page. No config is needed for a full URL:

   ```sh
   bunx facetshot https://example.com
   ```

   The first run starts a background helper that keeps the browser open for 15 minutes, so the next run is quick.
   `bunx facetshot daemon stop` stops it now.

4. Open the `.sheet.jpg` file whose path the summary prints.

5. To use short paths such as `/settings`, and let facetshot build and start your app, write a config in your
   project's folder:

   ```sh
   bunx facetshot init
   ```

6. Connect your coding agent, restart it (Claude Code asks you to approve the `facetshot` server the first time), and
   ask it something like "check /settings on a phone":

   ```sh
   bunx facetshot init --agent claude    # or cursor, codex, all
   ```

The rest of this page writes `facetshot …`. Installed in a project, type `bunx facetshot …`.
[Getting started](docs/getting-started.md) walks through all of this, including what to do when `init` doesn't
recognise your project, and how to update or remove facetshot.

## Why use it

Checking a UI change properly means looking at it on a phone, a tablet and a desktop, in light and dark mode and with
large text. That is a dozen screenshots per screen, and most of the effort goes into getting ready: building the app,
starting its servers, signing in, making test data and waiting until the page has finished loading.

facetshot does that preparation once and keeps the results. A
[background helper](docs/concepts.md#the-background-helper) keeps the browser, your app's servers and any simulators
running between runs, so a second look usually takes seconds. A screenshot is taken when the network is quiet, fonts
are loaded and anything your config marks as "still loading" has gone, instead of after a fixed wait. However many
agents and terminals ask at the same time, they share one background helper and its limits, so the machine stays
usable. See [Speed and machine safety](docs/performance.md).

## What you can do with it

- Check a UI change before you call it done: run `check` on the screens it touched, look at the sheets that have
  problems, fix them, then compare.
- Review a design on every form factor: one sheet shows desktop, tablet in both orientations and phone, in light and
  dark.
- Reproduce a bug report such as "the menu is cut off on my phone in dark mode": open the page on `phone` as `dark`,
  right-click, and read the screenshot and the log.
- See what a change did: `facetshot diff` repeats the last command and shows only the screens that changed.
- Check everything before a release: list the pages and [flows](docs/flows.md#a-batch-to-run-again) once in a profile
  of your own (say `release`) in `facetshot.config.ts`, then run `facetshot -p release` whenever you need to.
- Compare your local build with production: take screenshots of the live site, save them as a baseline, and compare.
- Add screenshots to a pull request: `--format md` prints a Markdown summary with links to the sheets
  ([CI](docs/ci.md) says how to make the links work in a comment).

## Connecting an agent

`facetshot init --agent claude` (or `cursor`, `codex`, `all`), run in your project's folder, adds two things:

- **The MCP server**, so the agent gets facetshot's tools: registered in `.mcp.json` (Claude Code),
  `.cursor/mcp.json` (Cursor) or `.codex/config.toml` (Codex, read once you trust the project).
- **The skill**, plain Markdown that tells the agent when to take screenshots and how: `.claude/skills/facetshot/`
  (Claude Code), `.agents/skills/facetshot/` (Codex), or a rule in `.cursor/rules/facetshot.mdc` (Cursor).

Commit these files and everyone on the team gets the same setup. [AI agents](docs/agents.md) says what each file
contains and how to set it up by hand.

| MCP tool  | What it does                                                         |
| --------- | -------------------------------------------------------------------- |
| `check`   | reads screens for problems, without screenshots (the cheapest call)  |
| `capture` | takes screenshots and returns one contact sheet per screen           |
| `compare` | repeats the last capture and returns only what changed               |
| `inspect` | screenshots at full size, or part of one, with their log lines       |
| `list`    | devices, variants, profiles, flows, checks, runs and open sessions   |
| `open`    | opens a page or app window and keeps it open (a session)             |
| `act`     | does steps in a session and returns the new screenshot and log lines |
| `close`   | closes a session, optionally saving its steps as a flow              |

Every parameter is in [MCP tools](docs/mcp.md).

## Commands

| Command                                         | What it does                                                   |
| ----------------------------------------------- | -------------------------------------------------------------- |
| `facetshot <targets…> [--on …] [--as …]`        | takes screenshots and prints a short summary                   |
| `facetshot check <targets…>`                    | reads the screens for problems, without screenshots            |
| `facetshot diff`                                | repeats the last command and shows what changed                |
| `facetshot open` / `act` / `look` / `close`     | uses a screen step by step (a session)                         |
| `facetshot logs <session\|run\|latest>`         | prints a run's logs, or follows a session's as they happen     |
| `facetshot init [--url …] [--agent …]`          | writes a starter config and connects your agent                |
| `facetshot mcp`                                 | runs the MCP server for an agent (`init --agent` sets it up)   |
| `facetshot doctor`                              | checks this machine and says how to fix what's missing         |
| `facetshot list`, `baseline`, `daemon`, `clean` | what you can name, saved runs, the background helper, clean-up |

`fshot` is a shorter name for the same command. Every command and option is in the
[command reference](docs/cli.md).

## Sessions

A session keeps one screen open so you or an agent can use it step by step. After each step you get a screenshot, the
log lines since the last step, and a list of what on screen can be clicked or typed into:

```sh
facetshot open /settings --on phone     # prints the session id (s-42cb1d) and what's on screen, e.g.
                                        #   e14 textbox "Name"   e18 button "Save"
facetshot act s-42cb1d "fill:e14=Grace" click:e18
facetshot close s-42cb1d --save flows/edit-settings.yaml
```

Sessions open web pages and desktop app windows (Electron, Tauri, native Mac apps). iOS simulators take
[flows](docs/flows.md) for now. See [Sessions](docs/sessions.md).

## Other browsers

Screenshots are taken in Playwright's Chromium unless you ask for others. `--browser webkit` takes web pages in WebKit
(Safari's engine; install it once with `bunx playwright install webkit`) instead of Chromium; list both
(`--browser chromium,webkit`) to compare them, and each browser gets its own rows on the sheet. See
[Other browsers](docs/web.md#other-browsers) for Firefox and the browsers installed on your machine.

## What a run gives you

Each run writes a folder under `.facetshot/runs/` with the contact sheets, every screenshot at full resolution, a
report, a summary and the logs. See [What a run gives you](docs/concepts.md#what-a-run-gives-you).

This is the sheet for the pricing page of [the example app](examples/vite-react). Its plan cards don't wrap, so on a
tablet and a phone they run off the screen:

![A contact sheet: the pricing page of the example app on desktop, tablet and phone, in light, dark and large text. The plan cards run off the right edge on tablet and phone.](docs/images/pricing-sheet.jpg)

## Examples

Each folder in [`examples/`](examples) is a small app with a working config, and a few bugs left in on purpose for
the checks to find: [`vite-react`](examples/vite-react) (with Storybook), [`electron`](examples/electron),
[`tauri`](examples/tauri), [`flutter`](examples/flutter) and [`swiftui`](examples/swiftui).

## How it compares

[Playwright](https://playwright.dev) does all of facetshot's browser work: pages, device emulation, Electron, and the
accessibility snapshots that list what can be clicked. facetshot adds the project around it (builds, servers, sign-in,
test data, devices and display settings) and puts the results together.

[Playwright MCP](https://github.com/microsoft/playwright-mcp) gives an agent a general-purpose browser. Use it when an
agent needs to browse the web or automate a site. facetshot's sessions cover a smaller job: they open your own app,
already built, served and signed in, on a device and display setting from your config, and a session can be saved as
a flow to replay on every device.

Visual regression services (Chromatic, Percy, Argos and others) and Playwright's `toHaveScreenshot` compare approved
screenshots in CI and fail a build when they change. facetshot's comparisons are for checking your own work and don't
fail a run. For native code, swift-snapshot-testing keeps reference images in tests;
[FacetshotKit](FacetshotKit/README.md) only draws SwiftUI views so facetshot can take screenshots of them.

## Documentation

The [documentation index](docs/README.md) lists every page. Good places to start:

- [Getting started](docs/getting-started.md)
- [How it works](docs/concepts.md), with a glossary
- [Command reference](docs/cli.md) and [configuration reference](docs/configuration.md)
- [Troubleshooting](docs/troubleshooting.md)

## Contributing

From a clone:

```sh
bun install
bun test test              # unit and end-to-end tests; Electron, Mac and Tauri tests skip what isn't installed or permitted
bun --bun tsc --noEmit -p .
bun run lint               # Prettier
```

There is no automated iOS simulator test yet. [Architecture](docs/architecture.md) describes how the code is laid out
and how the parts talk to each other. Please open an issue before a large change, so the approach can be agreed first.

## License

[MIT](LICENSE)
