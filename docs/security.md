# Security

facetshot runs your app's code, signs in as your personas and, when an agent drives it, does what the agent asks.
This page describes what that allows, what facetshot writes to disk, and what it masks. How to report a
vulnerability, and a short list of hardening steps, are in [SECURITY.md](../SECURITY.md).

## What an agent can do

An agent connected over MCP can do everything the command line can:

- Build your app, start its services and make test data, by running the commands in your config.
- Open any address: a path in your app, or any full URL. `goto` steps and links on the page can lead anywhere.
- Click, type and submit forms as the signed-in persona, through `steps` in `capture`, `check` and `compare`, and
  through `act` in a session. On a live site, that includes deleting or buying things.
- Act on any session your user account has open, from any project, by its id
  ([Sessions](sessions.md#from-the-command-line)).
- Save a session's steps as a flow file (`.yaml`, `.yml` or `.json`, inside the project folder, never over a file
  that isn't a flow). Text typed in the session, passwords included, is saved as typed.
- In a Mac app's window, press, type and choose menu items through macOS's Accessibility interface, once the app
  that runs facetshot has that permission. Element steps use the element's own action. Points, drags, scrolls, hovers
  and typing are real input ([Steps in a Mac window](desktop.md#steps-in-a-mac-window)): facetshot brings the app to
  the front first and refuses a point outside its window, but the pointer events themselves go to whatever is on
  screen at that point. Don't work at the same Mac while they run. The permission covers every app on the Mac.

For live sites, use test accounts, never a real person's, and keep personas for production away from agents you
don't supervise. MCP clients that ask before calling non-read-only tools will ask for every tool except `inspect`
and `list` ([Tool hints](mcp.md#tool-hints)).

## Trust model

- The config file is TypeScript that facetshot runs. Anyone who can change `facetshot.config.ts`, or a flow it
  points at, can run code as you. Treat it like a build script.
- The background helper runs as your user account and listens on a Unix socket in `~/.facetshot` (or
  `FACETSHOT_HOME`). The folder is created readable only by you and the socket only by you, and it accepts nothing
  from the network. Any process running as your user can still send it requests and drive it.
- Clients send their environment variables over that socket with each request, so the helper can evaluate the config
  as the caller would. They aren't written to disk.
- The helper works with the permissions (Screen Recording, Accessibility) of the app that started it. A process that
  doesn't have Accessibility itself can still get real input on a Mac window through a helper that does.

## What is stored on disk

| Where                                 | What                                                                        | Removed                                                 |
| ------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------- |
| `.facetshot/runs/<id>/`               | screenshots, sheets, reports, masked logs, the manifest                     | only the last 20 runs are kept; `facetshot clean`       |
| `--out <folder>`                      | the same, in a folder you chose                                             | `--clean` deletes that whole folder before the run      |
| `.facetshot/baselines/`               | runs you saved                                                              | `facetshot baseline rm`, `facetshot clean --all`        |
| `.facetshot/sessions/<id>/`           | a session's screenshots                                                     | when the session closes                                 |
| `.facetshot/flows/`                   | steps given inline (`--do`, MCP `steps`), as flow files, with typed text    | `facetshot clean`                                       |
| `.facetshot/logs/*.log`               | the raw output of builds and servers, not masked                            | `facetshot clean`                                       |
| `.facetshot/auth/<persona>.json`      | signed-in state saved by a persona's `login` flow (cookies and storage)     | `facetshot clean`, or delete it yourself                |
| `.facetshot/mac-home/`                | the home folder a native Mac app runs with, and whatever it saves there     | delete it yourself                                      |
| `.facetshot/last-request.json`        | the last run request, steps included, for `facetshot diff` and `compare`    | `facetshot clean`                                       |
| `.facetshot/fixtures.ledger.json`     | the test data that hasn't been removed yet                                  | as the data is removed                                  |
| `~/.facetshot/daemon.log`, `daemon.*` | the background helper's own log, socket and process id                      | delete the log yourself                                 |
| `~/.facetshot/ports.json`, `locks/`   | port blocks from `stablePorts`, and machine-wide locks                      | when a checkout is removed, and when a lock is released |
| `~/.facetshot/cache/`                 | built apps, keyed by their inputs, shared by every project                  | `facetshot clean`                                       |
| `~/.facetshot/bin/`                   | the compiled Mac window helper                                              | delete it yourself                                      |
| Playwright's browser cache            | the browsers (`~/Library/Caches/ms-playwright` or `~/.cache/ms-playwright`) | `facetshot uninstall --browsers`                        |

`facetshot uninstall` removes everything above in `~/.facetshot` and the project's `.facetshot/` at once
([`uninstall`](cli.md#uninstall)).

Keep `.facetshot/` out of version control (see [Getting started](getting-started.md#2-take-screenshots-of-any-page)
for the lines that still let you commit baselines), and don't commit storage state files you saved yourself (such as
`.auth/`).

## What is masked

Log lines in a run's `logs.txt` and `logs.ndjson`, in session responses, and session addresses in
`facetshot list sessions` are masked before they are written or sent:

- values after keys such as `token`, `access_token`, `api_key`, `key`, `secret`, `password`, `auth`,
  `authorization`, `signature`, `session` and `code`, in query strings, JSON and `key=value` text. These words match
  inside longer names too (`monkey: …` is masked), and only values of 4 or more characters, up to the first space
- `Bearer` and `Basic` credentials
- anything shaped like a JWT

These are not masked:

- a secret without one of those keys in front of it, for example a token printed on its own in console text
- the raw server and build logs in `.facetshot/logs/`, and `~/.facetshot/daemon.log`
- screenshots, the element lists in session responses, page titles, dialog text, and `--tree` text

Server logs are read in pieces of at most 256 KB at a time; a server that writes more than that between two reads
loses the middle from facetshot's log (the raw file keeps it).

To hide something in screenshots, list its selector in
[`web.mask`](web.md#keeping-screenshots-the-same-from-run-to-run); it is painted over in every screenshot.

## What goes to the model

Over MCP, the agent's model receives the tool responses: images of screenshots and sheets, absolute file paths on your
machine, masked log lines, element names and the current values of form fields, and the accessibility tree when
asked for. Anything visible on the page, or typed into it, can reach the model.
