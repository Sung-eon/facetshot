# Command reference

Commands are written `facetshot …`, as typed after a global install. Without installing, or with facetshot in your
project, type `bunx facetshot …` ([Installing](#installing-updating-and-removing)).

| Command                                     | What it does                                                        |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `facetshot <targets…> [options]`            | takes screenshots and prints a short summary                        |
| `facetshot -p <profile>`                    | takes the profile's own targets (a batch you run again and again)   |
| `facetshot check <targets…> [options]`      | reads screens for problems, without screenshots                     |
| `facetshot diff [against]`                  | repeats the last command and shows what changed                     |
| `facetshot list [what]`                     | devices, variants, profiles, flows, checks, runs or sessions        |
| `facetshot init [--url …] [--agent …]`      | writes a starter config and connects an agent                       |
| `facetshot setup [--browser …]`             | installs the browsers facetshot uses, then runs `doctor`            |
| `facetshot doctor`                          | checks this machine and project, and says how to fix what's missing |
| `facetshot uninstall [--browsers] [--yes]`  | removes facetshot and what it made from this machine and project    |
| `facetshot mcp`                             | runs the MCP server over standard input and output                  |
| `facetshot baseline save\|list\|rm <name>`  | keeps a run to compare with later                                   |
| `facetshot daemon status\|stop`             | shows or stops the background helper                                |
| `facetshot clean [--all]`                   | removes runs, test data and simulators, and stops everything        |
| `facetshot open <target> [--on d] [--as v]` | opens a page or app window to use step by step (a session)          |
| `facetshot act <id> <step…>`                | does steps in a session, then shows it again                        |
| `facetshot look <id>`                       | shows a session again                                               |
| `facetshot close <id> [--save file]`        | closes a session, optionally keeping its steps as a flow            |
| `facetshot logs <id\|run\|latest>`          | prints a run's logs, or a session's (live with `--follow`)          |
| `facetshot --help`, `-h`                    | prints the commands, steps and targets in short                     |
| `facetshot --version`, `-v`                 | prints the version                                                  |

`fshot` is a shorter name for the same command. Targets are described in
[How it works](concepts.md#targets-devices-and-variants).

## Installing, updating and removing

facetshot needs [Bun](https://bun.sh) 1.3 or newer. Your project needs no `package.json`: facetshot works the same in
a Flutter, Swift or any other folder. There are three ways to run it:

| Way                        | Install                | Run                | Update                        | Remove                                                  |
| -------------------------- | ---------------------- | ------------------ | ----------------------------- | ------------------------------------------------------- |
| Installed for your user    | `bun add -g facetshot` | `facetshot …`      | `bun add -g facetshot@latest` | `facetshot uninstall` (it also runs `bun remove -g`)    |
| Without installing         | nothing                | `bunx facetshot …` | by itself (below)             | `bunx facetshot uninstall`                              |
| In a project, for everyone | `bun add -d facetshot` | `bunx facetshot …` | `bun update facetshot`        | `bunx facetshot uninstall`, then `bun remove facetshot` |

- **Installed** is the one to pick for regular use: the version changes only when you update it, and the MCP server
  starts without asking the registry first.
- **Without installing** needs nothing but Bun. `bunx` downloads the package into a `bunx-…-facetshot@…` folder in
  the system's temporary folder and runs it from there; it asks the registry for a newer version once a day
  (`bunx facetshot@latest` asks every time, `bunx facetshot@0.1.0` runs that version).
- **In a project**, the version is pinned in the project's lockfile for everyone who clones it, and the config gets
  types from `import { defineConfig } from 'facetshot'` ([what is checked](configuration.md#how-the-config-is-checked)).

To install a tagged version from GitHub instead of npm (tags are the bare version number):
`bun add -g github:Sung-eon/facetshot#0.1.0`. This hasn't been tried yet ([Status](status.md#known-limits)).

After installing or updating, run `facetshot setup` once. A newer facetshot may use a newer Playwright, whose
browsers are a separate download.

### `setup`

Installs the browsers facetshot uses with facetshot's own copy of Playwright, so they are always the builds it can
start, then runs [`doctor`](#doctor) and exits with its result. Chromium (about 600 MB) is always installed;
`--browser webkit,firefox` adds those. The browsers go to Playwright's shared folder (`~/Library/Caches/ms-playwright`
on macOS, `~/.cache/ms-playwright` on Linux), where any Playwright project of the same version uses them too.
`chrome`, `msedge` and `moz-firefox` are the browsers already installed on your machine; `setup` doesn't install
those.

### `uninstall`

Removes facetshot from this machine, and from the project you run it in:

1. Lists everything it will remove and asks before removing it. `--yes` skips the question (for agents and scripts).
   Without a terminal and without `--yes`, it prints the list and removes nothing.
2. Stops the background helper, deletes facetshot's own simulators and its home folder (`~/.facetshot`).
3. In a project (a `facetshot.config.ts` found from the current folder upwards, or the folder you are in): deletes
   `.facetshot/` (runs, logs, baselines, saved sign-ins) and undoes what `init --agent` wrote: the `facetshot` entry in
   `.mcp.json`, `.cursor/mcp.json` and `.codex/config.toml` (other servers stay; a file goes only when nothing else
   is in it), `.claude/skills/facetshot`, `.agents/skills/facetshot`, `.cursor/rules/facetshot.mdc`, and the line
   about facetshot in `CLAUDE.md` or `AGENTS.md` if it is still exactly as `init` wrote it.
4. Keeps `facetshot.config.ts`, since you may have changed it, and prints how to delete it.
5. Installed with `bun add -g`, runs `bun remove -g facetshot` last. In a project, it prints `bun remove facetshot`
   for you to run. Through `bunx`, there is nothing to remove.

Playwright's browsers stay unless you pass `--browsers`. Then it runs Playwright's own `uninstall` with facetshot's
copy of Playwright: that unregisters facetshot's Playwright and deletes each browser in the shared folder that no
other Playwright on this machine is registered as using. Browsers another project's Playwright still uses are kept.

## Taking screenshots

```sh
facetshot /settings /billing --on phone,desktop --as light,dark+large
```

| Option                    | Meaning                                                                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--on <devices>`          | devices or groups, comma-separated. Default: the profile's                                                                                                                                                                 |
| `--as <variants>`         | variants or groups, comma-separated; `+` combines (`dark+large`). Default: the profile's                                                                                                                                   |
| `--browser <names>`       | take web pages in these browsers instead of Chromium (include `chromium` to keep it): `webkit`, `firefox`, `chrome`, `msedge`, `moz-firefox`; or per device, `--on phone@webkit` ([Other browsers](web.md#other-browsers)) |
| `-p, --profile <name>`    | a profile from your config (default: `default`)                                                                                                                                                                            |
| `--diff`, `--diff=<name>` | compare with the previous run, or with a baseline name, a run id or a folder ([Comparing](comparing.md))                                                                                                                   |
| `--checks <names>`        | the checks to run, comma-separated, instead of the default ones; `all` for every check ([Checks](checks.md))                                                                                                               |
| `--do <step>`             | a step before the screenshot, repeatable: `--do "click:text=Save" --do shot:saved` ([Steps](flows.md#steps))                                                                                                               |
| `--out <folder>`          | write this run to a folder of your choice instead of `.facetshot/runs/<id>`                                                                                                                                                |
| `--clean`                 | delete the `--out` folder first                                                                                                                                                                                            |
| `--sheet-width <px>`      | contact sheet width (default 1600)                                                                                                                                                                                         |
| `--format text\|md\|json` | what to print: the short summary (default), Markdown with each sheet as an image, or the manifest. The Markdown's image links are file paths on this machine ([CI](ci.md#a-summary-for-the-pull-request))                  |
| `--json`                  | the same as `--format json`                                                                                                                                                                                                |
| `--open`                  | open `report.html` when the run is done                                                                                                                                                                                    |
| `--no-daemon`             | do everything in this process; nothing stays running afterwards                                                                                                                                                            |
| `-c, --config <file>`     | use this config instead of looking for `facetshot.config.ts` upwards from the current folder                                                                                                                               |

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
installs the skill for that agent, and adds one line to `CLAUDE.md` or `AGENTS.md` (asked at a terminal; `--yes`
adds it without asking). See
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
and deletes facetshot's own simulators. Saved sign-ins in `.facetshot/auth/` and the steps given inline
(`.facetshot/flows/`) are deleted too, so personas sign in again on the next run. Baselines are kept unless you pass
`--all`. The caches in `~/.facetshot/cache` are shared by every project on this machine, and `clean` empties them for
all of them.

## Sessions

See [Sessions](sessions.md).

| Command            | Options                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open <target>`    | `--on <device>`, `--as <variant>`, `--browser <name>` (one each; `--browser` needs `--on`), and the same view options as `act`                                                     |
| `act <id> <step…>` | `--no-elements`, `--no-screenshot` (leave out the list or the screenshot), `--tree` (the page's text and structure), `--full` (the whole page), `--level <level>` (logs), `--json` |
| `look <id>`        | the same options as `act`                                                                                                                                                          |
| `close <id>`       | `--save <file>`: write the steps that worked as a flow (`.yaml`, `.yml` or `.json`, inside the project folder)                                                                     |

`act` exits with 1 when a step didn't work; the rest of its output shows where the screen ended up. `facetshot list
sessions` lists the open sessions (`--json` for programs).

## `logs`

```sh
facetshot logs latest                   # the last run's logs, a section per screenshot
facetshot logs <run-id> --level warn    # only warnings and errors
facetshot logs s-3b8ec4 --follow        # a session's logs as they happen, until Ctrl-C
facetshot logs latest --json            # one JSON object per line
```

Levels are `debug`, `info` (the default), `warn` and `error`. See [Logs](logs.md).

## Exit codes

| Code | Meaning                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | every screenshot was taken, including any taken after the readiness timeout                                                                |
| 1    | some screenshots failed, or something went wrong around them (the summary says what); for `act`, a step didn't work                        |
| 2    | the command or the config is wrong                                                                                                         |
| 3    | something this machine needs is missing or busy (a browser, Xcode, a port, a permission)                                                   |
| 4    | an unexpected error: often a bug in facetshot, but also a browser or tool failing in a way facetshot doesn't recognise, or a second Ctrl-C |

Exit code 4 that isn't from a second Ctrl-C is worth reporting as a bug.

Three things don't change the exit code: problems found by checks, changes found by comparing, and screenshots taken
after the page didn't become ready in time. The last are marked `readyTimedOut: true` in `manifest.json`, and the
summary lists them under "Taken before the screen settled". To fail a CI job on any of these, read the manifest
([Failing a job](ci.md#failing-a-job)).

## Environment variables

| Variable                         | Effect                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `FACETSHOT_HOME`                 | where per-user state lives (default `~/.facetshot`): the background helper's socket and log, locks, ports, caches |
| `FACETSHOT_NO_DAEMON`            | the same as `--no-daemon` for every command, including the MCP server                                             |
| `FACETSHOT_IDLE_MINUTES`         | how long the background helper waits without work before it stops (default 15)                                    |
| `FACETSHOT_SESSION_IDLE_MINUTES` | how long an unused session stays open (default 10)                                                                |
| `FACETSHOT_CONFIG`               | the config the MCP server uses                                                                                    |
| `FACETSHOT_CWD`                  | the folder the MCP server looks for a config from                                                                 |
| `FACETSHOT_MCP_MAX_IMAGES`       | sheets per MCP response (default 4)                                                                               |
