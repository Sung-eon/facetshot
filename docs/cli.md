# Command reference

| Command                                     | What it does                                                        |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `facetshot <targets…> [options]`            | takes screenshots and prints a short summary                        |
| `facetshot check <targets…> [options]`      | reads screens for problems, without screenshots                     |
| `facetshot diff [against]`                  | repeats the last command and shows what changed                     |
| `facetshot list [what]`                     | devices, variants, profiles, checks or runs                         |
| `facetshot init [--url …] [--agent …]`      | writes a starter config and connects an agent                       |
| `facetshot doctor`                          | checks this machine and project, and says how to fix what's missing |
| `facetshot mcp`                             | runs the MCP server over standard input and output                  |
| `facetshot baseline save\|list\|rm <name>`  | keeps a run to compare with later                                   |
| `facetshot daemon status\|stop`             | shows or stops the background helper                                |
| `facetshot clean [--all]`                   | removes runs, test data and simulators, and stops everything        |
| `facetshot open <target> [--on d] [--as v]` | opens a page to use step by step (a session)                        |
| `facetshot act <id> <step…>`                | does steps in a session, then shows it again                        |
| `facetshot look <id>`                       | shows a session again                                               |
| `facetshot close <id> [--save file]`        | closes a session, optionally keeping its steps as a flow            |
| `facetshot logs <id\|run\|latest>`          | prints a run's logs, or a session's (live with `--follow`)          |

`fshot` is a shorter name for the same command. Targets are described in
[How it works](concepts.md#targets-devices-and-variants).

## Taking screenshots

```sh
facetshot /settings /billing --on phone,desktop --as light,dark+large
```

| Option                    | Meaning                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--on <devices>`          | devices or groups, comma-separated. Default: the profile's                                                                                                                 |
| `--as <variants>`         | variants or groups, comma-separated; `+` combines (`dark+large`). Default: the profile's                                                                                   |
| `--browser <names>`       | take web pages in other browsers too: `webkit`, `firefox`, `chrome`, `msedge`, `moz-firefox`; or per device, `--on phone@webkit` ([Other browsers](web.md#other-browsers)) |
| `-p, --profile <name>`    | a profile from your config (default: `default`)                                                                                                                            |
| `--diff`, `--diff=<name>` | compare with the previous run, or with a baseline name, a run id or a folder ([Comparing](comparing.md))                                                                   |
| `--checks <names>`        | the checks to run, comma-separated, instead of the default ones; `all` for every check ([Checks](checks.md))                                                               |
| `--do <step>`             | a step before the screenshot, repeatable: `--do "click:text=Save" --do shot:saved` ([Steps](flows.md#steps))                                                               |
| `--out <folder>`          | write this run to a folder of your choice instead of `.facetshot/runs/<id>`                                                                                                |
| `--clean`                 | delete the `--out` folder first                                                                                                                                            |
| `--sheet-width <px>`      | contact sheet width (default 1600)                                                                                                                                         |
| `--format text\|md\|json` | what to print: the short summary (default), Markdown with each sheet as an image (for a pull request or an issue), or the manifest                                         |
| `--json`                  | the same as `--format json`                                                                                                                                                |
| `--open`                  | open `report.html` when the run is done                                                                                                                                    |
| `--no-daemon`             | do everything in this process; nothing stays running afterwards                                                                                                            |
| `-c, --config <file>`     | use this config instead of looking for `facetshot.config.ts` upwards from the current folder                                                                               |

While it works, facetshot shows progress on one line in a terminal, and prints failures as they happen when its
output isn't a terminal. When it's done it prints the summary: counts and timing, the sheets, what failed and why,
and what the checks found.

## `check`

Takes the same options. Opens each screen, waits for it to be ready, runs every check except `a11y`
(`--checks all` adds it), and prints what it found. It takes no screenshots, which makes it the quickest way to find
which screens need a look.

## `diff`

Repeats your last `facetshot` command with `--diff`, or against the baseline you name:
`facetshot diff before-redesign`.

## `list`

`facetshot list devices` (the default), `variants`, `profiles`, `flows`, `checks`, `runs` or `sessions`. `flows`
finds the flow files in the project; `sessions --json` prints the open sessions as JSON.

## `init`

Writes `facetshot.config.ts` from what the project uses, unless a config exists. With `--url <address>`, writes a
config for an app that is already running. With `--agent claude|cursor|codex|all`, registers the MCP server and
installs the skill for that agent; with `--yes`, also appends a line to an existing `CLAUDE.md` or `AGENTS.md`. See
[AI agents](agents.md#connecting-your-agent) for exactly what it writes.

## `doctor`

Checks the browsers, the config, the ports it asks for, Xcode and simulators when you use Apple targets, Electron
when you use it, locks held by other builds, and the background helper, and gives the command that fixes each
problem.

## `baseline`

`save <name>` copies your latest run to `.facetshot/baselines/<name>`; `list` shows the saved baselines; `rm <name>`
removes one.

## `daemon`

`status` shows whether the background helper is running and what it holds (browsers, servers, simulators, test
data). `stop` stops it after the runs in progress finish, closing everything it started. See
[Architecture](architecture.md#lifecycle).

## `clean`

Stops the background helper, removes test data that runs left behind, deletes runs, logs, build stamps and caches,
and deletes facetshot's own simulators. Baselines are kept unless you pass `--all`. Saved sign-ins in
`.facetshot/auth/` are kept; delete that folder yourself to sign in again.

## Sessions

See [Sessions](sessions.md).

| Command            | Options                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open <target>`    | `--on <device>`, `--as <variant>`, `--browser <name>` (one each; `--browser` needs `--on`), `--json`                                                                               |
| `act <id> <step…>` | `--no-elements`, `--no-screenshot` (leave out the list or the screenshot), `--tree` (the page's text and structure), `--full` (the whole page), `--level <level>` (logs), `--json` |
| `look <id>`        | the same options as `act`                                                                                                                                                          |
| `close <id>`       | `--save <file>`: write the steps that worked as a flow, inside the project folder                                                                                                  |
| `sessions`         | `--json`                                                                                                                                                                           |

`act` exits with 1 when a step didn't work; the rest of its answer shows where the page ended up.

## `logs`

```sh
facetshot logs latest                   # the last run's logs, a section per screenshot
facetshot logs <run-id> --level warn    # only warnings and errors
facetshot logs s-3b8ec4 --follow        # a session's logs as they happen, until Ctrl-C
facetshot logs latest --json            # one JSON object per line
```

Levels are `debug`, `info` (the default), `warn` and `error`. See [Logs](logs.md).

## Exit codes

| Code | Meaning                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | every screenshot was taken                                                                                                                                   |
| 1    | some screenshots failed, or something went wrong around them (the summary says what); for `act`, a step didn't work                                          |
| 2    | the command or the config is wrong                                                                                                                           |
| 3    | something this machine needs is missing or busy (a browser, Xcode, a port, a permission)                                                                     |
| 4    | an unexpected error: often a bug in facetshot, but also a browser or tool failing in a way facetshot doesn't recognise, or a second Ctrl-C. Please report it |

Problems found by checks don't change the exit code. To fail a CI job on them, read `manifest.json`
([Continuous integration](ci.md)).

## Environment variables

| Variable                         | Effect                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `FACETSHOT_HOME`                 | where per-user state lives (default `~/.facetshot`): the background helper's socket and log, locks, ports, caches |
| `FACETSHOT_NO_DAEMON`            | the same as `--no-daemon` for every command, including the MCP server                                             |
| `FACETSHOT_IDLE_MINUTES`         | how long the background helper waits without work before it stops (default 15)                                    |
| `FACETSHOT_SESSION_IDLE_MINUTES` | how long an unused session stays open (default 10)                                                                |
| `FACETSHOT_CONFIG`               | the config the MCP server uses                                                                                    |
| `FACETSHOT_CWD`                  | the folder the MCP server looks for a config from                                                                 |
| `FACETSHOT_MCP_MAX_IMAGES`       | sheets per MCP answer (default 4)                                                                                 |
