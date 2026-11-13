# Security

facetshot runs your app's code, signs in as your personas and, when an agent drives it, does what the agent asks.
This page describes what that allows, what facetshot writes to disk, and what it masks.

## What an agent can do

An agent connected over MCP can do everything the command line can:

- Build your app, start its services and make test data, by running the commands in your config.
- Open any address: a path in your app, or any full URL. `goto` steps and links on the page can lead anywhere.
- Click, type and submit forms as the signed-in persona, through `steps` in `capture` and `check`, and through `act`
  in a session. On a live site, that includes deleting or buying things.
- Save a session's steps as a flow file, but only inside the project folder.
- In a Mac app's window, press, type and choose menu items through macOS's Accessibility interface, once you have
  given the app that runs facetshot that permission. Steps on a point, drags and typing are real input: they bring
  the app to the front and move the pointer, so don't work at the same Mac while they run. The permission covers
  every app, but facetshot only acts on the app it launched.

For live sites, use test accounts, never a real person's, and keep personas for production away from agents you
don't supervise. MCP clients that ask before calling non-read-only tools will ask for every tool except `inspect`
and `list` ([Tool hints](mcp.md#tool-hints)).

## Trust model

- The config file is TypeScript that facetshot runs. Anyone who can change `facetshot.config.ts`, or a flow it
  points at, can run code as you. Treat it like a build script.
- The background helper runs as your user account and listens on a Unix socket in `~/.facetshot` (or
  `FACETSHOT_HOME`). The socket is protected only by file permissions, so any process running as your user can send
  it requests and drive it. It accepts nothing from the network.
- Clients send their environment variables over that socket with each request, so the helper can evaluate the config
  as the caller would. They aren't written to disk.

## What is stored on disk

| Where                               | What                                                                    | Removed                                                 |
| ----------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| `.facetshot/runs/<id>/`             | screenshots, sheets, reports, masked logs, the manifest                 | only the last 20 runs are kept; `facetshot clean`       |
| `--out <folder>`                    | the same, in a folder you chose                                         | `--clean` deletes that whole folder before the run      |
| `.facetshot/baselines/`             | runs you saved                                                          | `facetshot baseline rm`, `facetshot clean --all`        |
| `.facetshot/sessions/<id>/`         | a session's screenshots                                                 | when the session closes                                 |
| `.facetshot/logs/*.log`             | the raw output of builds and servers, not masked                        | `facetshot clean`                                       |
| `.facetshot/auth/<persona>.json`    | signed-in state saved by a persona's `login` flow (cookies and storage) | `facetshot clean`, or delete it yourself                |
| `.facetshot/last-request.json`      | the last run request, for `facetshot diff` and `compare`                | `facetshot clean`                                       |
| `.facetshot/fixtures.ledger.json`   | the test data that hasn't been removed yet                              | as the data is removed                                  |
| `~/.facetshot/daemon.log`           | the background helper's own log                                         | delete it yourself                                      |
| `~/.facetshot/ports.json`, `locks/` | port blocks from `stablePorts`, and machine-wide locks                  | when a checkout is removed, and when a lock is released |
| `~/.facetshot/cache/`               | built apps, keyed by their inputs                                       | `facetshot clean`                                       |

Keep `.facetshot/` out of version control, and don't commit storage state files you saved yourself (such as
`.auth/`).

## What is masked

Log lines in a run's `logs.txt` and `logs.ndjson`, and in session answers, are masked before they are written:

- values after keys such as `token`, `access_token`, `api_key`, `key`, `secret`, `password`, `auth`,
  `authorization`, `signature`, `session` and `code`, in query strings, JSON and `key=value` text
- `Bearer` and `Basic` credentials
- anything shaped like a JWT

These are not masked:

- a secret without one of those keys in front of it, for example a token printed on its own in console text
- the raw server and build logs in `.facetshot/logs/`, and `~/.facetshot/daemon.log`
- screenshots, the element lists in session answers, and `--tree` text

To hide something in screenshots, list its selector in [`web.mask`](web.md#keeping-screenshots-the-same-from-run-to-run);
it is painted over in every screenshot.

## What goes to the model

Over MCP, the agent's model receives the tool answers: images of screenshots and sheets, absolute file paths on your
machine, masked log lines, element names and the current values of form fields, and the accessibility tree when
asked for. Anything visible on the page, or typed into it, can reach the model.
