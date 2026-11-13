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

1. Install [Bun](https://bun.sh) 1.3 or newer. facetshot runs on Bun whatever your app is built with, and your
   project needs no `package.json`.

2. Install facetshot, then the browser it uses (Chromium, about 600 MB):

   ```sh
   bun add -g facetshot
   facetshot setup
   ```

   To try it without installing, type `bunx facetshot …` instead of `facetshot …` throughout.

3. Take screenshots of any public page. No config is needed for a full URL:

   ```sh
   facetshot https://example.com
   ```

   The first run starts a background helper that keeps the browser open for 15 minutes, so the next run is quick.
   `facetshot daemon stop` stops it now.

4. Open the `.sheet.jpg` file whose path the summary prints.

5. To use short paths such as `/settings`, and let facetshot build and start your app, write a config in your
   project's folder, then take screenshots of your own pages:

   ```sh
   cd your-project
   facetshot init
   facetshot / /settings
   ```

6. Connect your coding agent, restart it (Claude Code asks you to approve the `facetshot` server the first time), and
   ask it something like "check /settings on a phone":

   ```sh
   facetshot init --agent claude    # or cursor, codex, all
   ```

[Getting started](docs/getting-started.md) walks through all of this, including what to do when `init` doesn't
recognise your project. [Installing, updating and removing](docs/cli.md#installing-updating-and-removing) covers
adding facetshot to a project instead, updating it, and `facetshot uninstall`.

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

Each agent gets two things: facetshot's **MCP server** (its tools) and its **skill** (plain Markdown that tells the
agent when to look and how). Install facetshot first, then:

- **Claude Code:** install the plugin once for all your projects,
  `/plugin install facetshot --marketplace Sung-eon/facetshot`, or write both into this project with
  `facetshot init --agent claude` (`.mcp.json` and `.claude/skills/facetshot/`).
- **Codex:** `facetshot init --agent codex` writes `.codex/config.toml` (read once you trust the project) and
  the skill in `.agents/skills/facetshot/`.
- **Cursor:** `facetshot init --agent cursor` writes `.cursor/mcp.json` and a rule,
  `.cursor/rules/facetshot.mdc`, that carries the whole skill.
- **Any other agent with MCP:** register the server `bunx facetshot mcp` (standard input and output), and point the
  agent at the skill in `skills/facetshot/` of facetshot's install.

Restart the agent afterwards. [AI agents](docs/agents.md) says what each file holds and how to set it up by hand.

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
(Safari's engine; install it once with `facetshot setup --browser webkit`) instead of Chromium; list both
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

facetshot is built on [Playwright](https://playwright.dev) and adds the project around it: builds, servers,
sign-in, test data, devices and display settings. [How facetshot compares](docs/comparison.md) sets it beside
`toHaveScreenshot`, the visual regression services and Playwright MCP, and says when each is the better fit.

## Documentation

The [documentation index](docs/README.md) lists every page. Good places to start:

- [Getting started](docs/getting-started.md)
- [How it works](docs/concepts.md), with a glossary
- [Command reference](docs/cli.md) and [configuration reference](docs/configuration.md)
- [Troubleshooting](docs/troubleshooting.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
