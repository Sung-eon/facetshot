# MCP tools and the command line

- [The tools at a glance](#the-tools-at-a-glance)
- [Parameters shared by capture, check and compare](#parameters-shared-by-capture-check-and-compare)
- [Each tool](#each-tool)
- [Output limits](#output-limits)
- [The command line](#the-command-line)
- [Exit codes and environment variables](#exit-codes-and-environment-variables)

The MCP server (`facetshot mcp`) and the command line do the same work through the same background helper. Use the
MCP tools when you have them; they return images you can see. The command line prints paths to the images instead.

## The tools at a glance

| Tool      | Does                                                                                      | Changes anything?                                   |
| --------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `list`    | lists devices, variants, profiles, flows, checks, recent runs or open sessions            | no                                                  |
| `check`   | opens screens and reads them for problems; no screenshots                                 | builds, starts servers, makes test data; runs steps |
| `capture` | takes screenshots; returns one contact sheet per screen and a summary                     | the same as `check`                                 |
| `compare` | repeats the last request (or the targets given) and returns only the sheets that changed  | the same as `check`                                 |
| `inspect` | returns screenshots from a run at full size, or part of one, with their problems and logs | no                                                  |
| `open`    | opens one screen and keeps it open (a session)                                            | the same as `check`                                 |
| `act`     | does steps in a session, then shows the screen again; with no steps it just looks again   | whatever the steps do, as the signed-in user        |
| `close`   | closes a session, optionally saving the steps that worked as a flow file                  | writes the flow file when asked                     |

## Parameters shared by capture, check and compare

| Parameter  | Meaning                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `targets`  | what to look at: `"/settings"`, `"https://…"`, `"app:/inbox"`, `"story:button--primary"`, `"preview:Book/Page"`, `"flows/x.yaml"`, `"flows/*.yaml"`, an alias |
| `devices`  | devices or groups, e.g. `["phone", "desktop"]`. Default: the profile's                                                                                        |
| `variants` | variants or groups, e.g. `["light", "dark"]`; `"dark+large"` is one combined variant. Default: the profile's                                                  |
| `profile`  | a profile from the config. Its devices and variants, and with no `targets`, its targets too (a batch)                                                         |
| `browsers` | `chromium`, `webkit`, `firefox`, `chrome`, `msedge`, `moz-firefox`. Naming any replaces Chromium unless you list `chromium` too. Default: Chromium only       |
| `steps`    | steps played before each screenshot, written inline (`"click:role=button[name='Delete']"`, `"wait:role=dialog"`, `"shot:confirm"`)                            |

`capture` without `targets` needs a `profile` that has targets. `compare` takes `targets`, `devices`, `variants`,
`browsers`; without `targets` it repeats the project's last `capture` or `check` request, narrowed by whatever
`devices`, `variants` or `browsers` you pass.

## Each tool

- **`capture`**: the shared parameters, plus `images`: `"sheets"` (default, one image per screen) or `"none"` (text
  and file paths only).
- **`check`**: the shared parameters, plus `checks`: which checks to run. Default: all but `a11y`; `["all"]` adds
  `a11y` (axe-core, slower).
- **`compare`**: `targets`, `devices`, `variants`, `browsers`, and `against`: `"previous"` (default), a baseline
  name, or a run id.
- **`inspect`**: `screen` (as the summary names it, e.g. `settings` or `delete-account.confirm`), `device`,
  `variant`, `run` (default: the latest), `region` (`{x, y, width, height}` in CSS pixels or points, with a device
  and variant), `diff` (the difference image instead). With a device and a variant you get that one screenshot.
  Leave either out to get the screen's screenshots that failed, have problems or changed, at most four.
- **`list`**: `what`: `devices` (default), `variants`, `profiles`, `flows`, `checks`, `runs`, `sessions`.
- **`open`**: `target` (a path or URL for a web page, `app:/path` with a window device for a desktop app), one
  `device`, one `variant`, `browser`, and the view options below.
- **`act`**: `session` (the id `open` returned, e.g. `s-1a2b3c`), `steps`, and the view options. Steps run in
  order and the first failure stops the rest; the response says which step failed and why and shows where the
  screen ended up. `shot` steps are ignored in a session.
- **`close`**: `session`, and `saveAs`: a `.yaml`, `.yml` or `.json` path for the flow file. It is resolved against
  the folder the MCP server runs in (normally the project) and must stay inside the project; it won't overwrite a
  file that isn't a flow. `keep`: a new or empty folder to copy the session's screenshots and log into; without it
  they are deleted when the session closes.

View options (`open` and `act`): `screenshot` (default true; false answers in text only, cheaper for steps you
needn't see), `elements` (default true: the list of what can be acted on, with refs), `tree` (the whole
accessibility tree as text: all the screen's text and structure), `full` (the whole page, not just what fits the
screen), `logLevel` (`debug`, `info` default, `warn`, `error`; `debug` adds every request).

## Output limits

- `capture` returns at most four sheets per call (`FACETSHOT_MCP_MAX_IMAGES`); the rest are named with their paths.
- Images are scaled to fit 1568 pixels on the long side.
- A session response lists at most 200 elements, only those on screen (scroll to reach the rest), and the last 40
  log lines. `inspect` shows the last 60 log lines of a screenshot.

## The command line

Installed for the user, run it as `facetshot …`; installed in a project or not installed, as `bunx facetshot …`.

| Command                                                          | Does                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `facetshot <targets…> [--on …] [--as …]`                         | takes screenshots and prints a short summary                       |
| `facetshot check <targets…>`                                     | reads screens for problems, without screenshots                    |
| `facetshot diff [name]`                                          | repeats the last command and compares (with a baseline if named)   |
| `facetshot -p <profile>`                                         | runs a profile's targets                                           |
| `facetshot list [what]`                                          | as the `list` tool; `list sessions --json` for programs            |
| `facetshot open <target> [--on d] [--as v]`                      | opens a session                                                    |
| `facetshot act <id> <step…>`, `facetshot look <id>`              | does steps / looks again                                           |
| `facetshot close <id> [--save flows/x.yaml] [--keep dir]`        | closes a session (`--keep`: copy its screenshots and log first)    |
| `facetshot logs <id\|run\|latest> [--follow] [--level] [--json]` | prints a run's logs, or follows a session's live                   |
| `facetshot baseline save\|list\|rm <name>`                       | keeps a run to compare against later                               |
| `facetshot init [--url …] [--agent …]`                           | writes a starter config and connects agents                        |
| `facetshot setup [--browser webkit,firefox]`                     | installs the browsers facetshot needs, then runs `doctor`          |
| `facetshot doctor`                                               | checks the machine and project, and says how to fix what's missing |
| `facetshot uninstall [--browsers] [--yes]`                       | removes facetshot from the machine and project (only when asked)   |
| `facetshot daemon status\|stop`, `facetshot clean`               | the background helper; remove runs, test data and what's running   |

Options: `--on` (devices), `--as` (variants), `--browser`, `-p/--profile`, `--diff` / `--diff=<name>` (compare with
the previous run, or a baseline or run id), `--checks a,b|all`, `--do <step>` (repeatable), `--out <folder>`,
`--clean`, `--format text|md|json` (`--json` is the same as `--format json`), `--open`, `--no-daemon`,
`-c/--config`. Session commands also take `--no-screenshot`, `--no-elements`, `--tree`, `--full`, `--level`.
Inline steps are the same everywhere: `--do`, `act`, MCP `steps`.

## Exit codes and environment variables

Exit codes: `0` all good; `1` some screenshots failed, or a session step didn't work; `2` the command or config is
wrong; `3` something on this machine is missing (the message says what); `4` an unexpected error. Findings and
changes don't change the exit code.

| Variable                            | Effect                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `FACETSHOT_HOME`                    | where per-user state lives (default `~/.facetshot`)                    |
| `FACETSHOT_NO_DAEMON`               | like `--no-daemon` everywhere (no sessions then)                       |
| `FACETSHOT_IDLE_MINUTES`            | how long the background helper waits idle before stopping (default 15) |
| `FACETSHOT_SESSION_IDLE_MINUTES`    | how long an unused session stays open (default 10)                     |
| `FACETSHOT_CONFIG`, `FACETSHOT_CWD` | the config, and the folder, the MCP server works from                  |
| `FACETSHOT_MCP_MAX_IMAGES`          | sheets per MCP response (default 4)                                    |
