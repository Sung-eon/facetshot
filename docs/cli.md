# Command reference

```
facetshot <targets…> [options]          take pictures
facetshot check <targets…> [options]    read screens for problems, no pictures
facetshot diff [against]                repeat the last command and show what changed
facetshot list [what]                   devices, variants, profiles, checks, runs
facetshot init [--url …] [--agent …]    write a starter config, connect an agent
facetshot doctor                        check this machine and project
facetshot mcp                           run as an MCP server over stdio
facetshot baseline save|list|rm <name>  keep a run to compare with later
facetshot daemon status|stop            the background helper
facetshot clean [--all]                 remove runs, test data, simulators; stop everything

facetshot open <target> [--on d] [--as v]   open a page to work step by step (a session)
facetshot act <id> <step…>                  do steps in it, then show it again
facetshot look <id>                         show it again
facetshot close <id> [--save file]          close it, optionally keeping its steps as a flow
facetshot sessions                          the open sessions
facetshot logs <id|run|latest>              a session's logs (live with --follow) or a run's
```

`fshot` is a shorter name for the same command.

## Taking pictures

```sh
facetshot /settings /billing --on phone,desktop --as light,dark+large
```

| Option                    | Meaning                                                                                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--on <devices>`          | devices or groups, comma-separated. Default: the profile's                                                                                                                                               |
| `--as <variants>`         | variants or groups, comma-separated; `+` combines (`dark+large`). Default: the profile's                                                                                                                 |
| `--browser <engines>`     | web pages in other browsers too: `webkit` (Safari's engine), `firefox`, or the installed `chrome`, `msedge`, `moz-firefox`; or per device, `--on phone@webkit` ([Other browsers](web.md#other-browsers)) |
| `-p, --profile <name>`    | a profile from your config (default: `default`)                                                                                                                                                          |
| `--diff [against]`        | compare with `previous` (the default), a baseline name, a run id, or a folder                                                                                                                            |
| `--checks <names>`        | checks to run, comma-separated, or `all` (see [Checks](checks.md))                                                                                                                                       |
| `--out <folder>`          | write this run to a folder of your choice instead of `.facetshot/runs/<id>`                                                                                                                              |
| `--clean`                 | empty `--out` first                                                                                                                                                                                      |
| `--sheet-width <px>`      | contact sheet width (default 1600)                                                                                                                                                                       |
| `--do <step>`             | a step before the picture, repeatable: `--do "click:text=Save" --do shot:saved` ([Flows](flows.md#without-a-file))                                                                                       |
| `--format text\|md\|json` | what to print: the short summary (default), Markdown with each sheet as an image (for a pull request or an issue), or the manifest                                                                       |
| `--open`                  | open `report.html` — every picture on one page — when the run is done                                                                                                                                    |
| `--no-daemon`             | do everything in this process; nothing stays running afterwards                                                                                                                                          |
| `-c, --config <file>`     | use this config instead of looking for `facetshot.config.ts` upwards from here                                                                                                                           |

Targets are described in [How it works](concepts.md#targets-devices-and-variants).

While it works, facetshot shows progress on one line in a terminal and prints failures as they happen elsewhere. When
it's done it prints the summary: counts and timing, the sheets, what failed and why, and what the checks found.

## `check`

Takes the same options. Opens each screen, waits for it, runs every check except `a11y` (`--checks all` adds it), and
prints what it found. No pictures are taken, which makes it the quickest way to find which screens need a look.

## `diff`

Repeats your last `facetshot` command with `--diff previous`, or against the baseline you name:
`facetshot diff before-redesign`.

## `list`

`facetshot list devices` (the default), `variants`, `profiles`, `checks` or `runs`.

## `init`

Writes `facetshot.config.ts` from what the project uses, unless one exists. With `--agent claude|cursor|codex|all`,
registers the MCP server and installs the skill for that agent; with `--yes`, also adds a line to `AGENTS.md` or
`CLAUDE.md`. See [AI agents](agents.md).

## `doctor`

Checks the browser, the config, the ports it asks for, Xcode and simulators when you use Apple targets, Electron when
you use it, locks held by other builds, and the background helper — and gives the command that fixes each problem.

## `baseline`

`save <name>` copies your latest run to `.facetshot/baselines/<name>`; `list` shows them; `rm <name>` removes one.

## `daemon`

`status` shows whether the background helper is running and what it holds (browsers, servers, simulators, test
data); `stop` stops it after the runs in progress finish, closing everything it started. It also stops by itself after
15 minutes without work (`FACETSHOT_IDLE_MINUTES` changes that).

## `clean`

Stops the background helper, removes test data that runs left behind, deletes runs, logs, build stamps and caches,
and deletes facetshot's own simulators. Baselines stay unless you pass `--all`.

## Sessions

See [Sessions](sessions.md) for the whole story.

| Command            | Options                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `open <target>`    | `--on <device>`, `--as <variant>`, `--browser <engine>` (one each), `--json`                                                                                             |
| `act <id> <step…>` | `--no-elements`, `--no-picture` (leave out the list or the picture), `--tree` (the page's text and structure), `--full` (whole page), `--level <level>` (logs), `--json` |
| `look <id>`        | the same as `act`                                                                                                                                                        |
| `close <id>`       | `--save <file>`: write the steps that worked as a flow                                                                                                                   |
| `sessions`         | `--json`                                                                                                                                                                 |

`act` exits with 1 when a step didn't work; the rest of its answer shows where the page ended up.

## `logs`

```sh
facetshot logs latest                   # the last run's logs, a section per picture
facetshot logs <run-id> --level warn    # only warnings and errors
facetshot logs s-3b8ec4 --follow        # a session's logs as they happen, until Ctrl-C
facetshot logs latest --json            # one JSON object per line
```

Levels are `debug`, `info` (the default), `warn` and `error`. See [Logs](logs.md).

## Exit codes

| Code | Meaning                                                                                  |
| ---- | ---------------------------------------------------------------------------------------- |
| 0    | every picture was taken                                                                  |
| 1    | some pictures failed, or something went wrong around them (the summary says what)        |
| 2    | the command or the config is wrong                                                       |
| 3    | something this machine needs is missing or busy (a browser, Xcode, a port, a permission) |
| 4    | a bug in facetshot — please report it                                                    |

Problems found by checks don't change the exit code: they're there for you to read.

## Environment variables

| Variable                         | Effect                                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `FACETSHOT_HOME`                 | where machine-wide state lives (default `~/.facetshot`): the daemon's socket and log, locks, caches |
| `FACETSHOT_NO_DAEMON`            | same as `--no-daemon` for every command, including the MCP server                                   |
| `FACETSHOT_IDLE_MINUTES`         | how long the background helper waits before stopping (default 15)                                   |
| `FACETSHOT_CONFIG`               | the config the MCP server uses                                                                      |
| `FACETSHOT_CWD`                  | the folder the MCP server looks for a config from                                                   |
| `FACETSHOT_MCP_MAX_IMAGES`       | sheets per MCP answer (default 4)                                                                   |
| `FACETSHOT_SESSION_IDLE_MINUTES` | how long an unused session stays open (default 10)                                                  |
