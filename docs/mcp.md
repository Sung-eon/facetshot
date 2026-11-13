# MCP tools

`facetshot mcp` runs an MCP server over standard input and output. [AI agents](agents.md) explains how to connect
it. This page lists every tool and parameter.

Runs go through the same [background helper](concepts.md#the-background-helper) as the command line. Each answer is
text and images, plus the same result as structured data for clients that read it. Long runs report progress as they
go, to clients that ask for it.

## Names compared with the command line

Some parameters have different names from the command-line options they match:

| MCP parameter         | Command line                      |
| --------------------- | --------------------------------- |
| `devices`             | `--on`                            |
| `variants`            | `--as`                            |
| `browsers`, `browser` | `--browser`                       |
| `steps`               | `--do`                            |
| `against` (`compare`) | `--diff`, `facetshot diff <name>` |
| `saveAs`              | `--save`                          |
| `logLevel`            | `--level`                         |
| `screenshot: false`   | `--no-screenshot`                 |
| `elements: false`     | `--no-elements`                   |

## `capture`

Takes screenshots and returns a summary and one contact sheet per screen.

| Parameter  | Type               | Meaning                                                                                                                                                                                     |
| ---------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `targets`  | string[]           | what to look at: `/settings`, `app:/inbox`, `story:button--primary`, `preview:Settings/Account`, `flows/x.yaml` or `flows/*.yaml`, or an alias. Leave out to take the profile's own targets |
| `devices`  | string[]           | devices or groups. Default: the profile's                                                                                                                                                   |
| `variants` | string[]           | variants or groups; `dark+large` combines. Default: the profile's                                                                                                                           |
| `profile`  | string             | a profile from the config: its devices and variants, and its targets when none are given ([Profiles](concepts.md#profiles))                                                                 |
| `browsers` | string[]           | other browsers for web pages: `chromium`, `webkit`, `firefox`, `chrome`, `msedge`, `moz-firefox`. Default: Chromium only                                                                    |
| `steps`    | string[]           | [steps](flows.md#steps) played before each screenshot, written as on the command line                                                                                                       |
| `images`   | `sheets` or `none` | `sheets` (the default): one sheet per screen, at most 4 (`FACETSHOT_MCP_MAX_IMAGES`). `none`: text and paths only                                                                           |

To compare with an earlier run, use `compare`. To read a detail a sheet is too small to show, use `inspect`.

## `check`

Reads screens for problems without taking screenshots, and returns the list as text. Takes `targets`, `devices`,
`variants`, `profile`, `browsers` and `steps` like `capture`, and:

| Parameter | Type     | Meaning                                                                          |
| --------- | -------- | -------------------------------------------------------------------------------- |
| `checks`  | string[] | which [checks](checks.md) to run. Default: all but `a11y`; `["all"]` adds `a11y` |

## `compare`

Takes the same screenshots again and returns only the sheets that changed. With no `targets`, it repeats the last
`capture` from this project.

| Parameter  | Type     | Meaning                                     |
| ---------- | -------- | ------------------------------------------- |
| `targets`  | string[] | what to compare instead of the last capture |
| `devices`  | string[] | as for `capture`                            |
| `variants` | string[] | as for `capture`                            |
| `browsers` | string[] | as for `capture`                            |
| `against`  | string   | `previous` (the default) or a baseline name |

## `inspect`

Returns screenshots from a run, scaled to fit 1568 pixels, each with its findings, notes and log lines. With a
`device` and a `variant` it returns that one screenshot. Leave either out to get the screen's screenshots that
failed, have problems or changed, at most 4.

| Parameter | Type                      | Meaning                                                            |
| --------- | ------------------------- | ------------------------------------------------------------------ |
| `screen`  | string, required          | the screen name as the summary shows it                            |
| `device`  | string                    | the device                                                         |
| `variant` | string                    | the variant                                                        |
| `run`     | string                    | a run id. Default: the latest run                                  |
| `region`  | `{ x, y, width, height }` | with a device and variant: only this part, in CSS pixels or points |
| `diff`    | boolean                   | return the difference image instead, if the run compared           |

## `list`

| Parameter | Type                                                                       | Meaning                         |
| --------- | -------------------------------------------------------------------------- | ------------------------------- |
| `what`    | `devices`, `variants`, `profiles`, `flows`, `checks`, `runs` or `sessions` | what to list. Default `devices` |

`flows` lists the flow files in the project with their start and shots, and `profiles` shows each profile's targets,
so an agent can run a check that already exists instead of writing a new one.

## `open`

Opens a screen and keeps it open as a [session](sessions.md) on one device and variant, with the project's servers,
sign-in and test data: a web page, or a desktop app's window ([what sessions open](sessions.md#what-sessions-open)).
Answers with the session id, a screenshot, the log, and what on screen can be acted on, with refs. The view options
below shape this first answer as they shape `act`'s.

| Parameter    | Type                               | Meaning                                                                                  |
| ------------ | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `target`     | string, required                   | a path (`/settings`) or a full URL; `app:/path` for a desktop app (with a window device) |
| `device`     | string                             | one device. Default: the profile's first (`desktop` when only `browser` is given)        |
| `variant`    | string                             | one variant. Default: the profile's first                                                |
| `browser`    | string                             | the browser, as for `browsers` above. Default Chromium                                   |
| `elements`   | boolean                            | list what can be acted on, with refs. Default true                                       |
| `screenshot` | boolean                            | return the screenshot. Default true; false answers in text only                          |
| `tree`       | boolean                            | also return the page's accessibility tree as text                                        |
| `full`       | boolean                            | take the whole page, not only the screen                                                 |
| `logLevel`   | `debug`, `info`, `warn` or `error` | the least important log lines to return. Default `info`                                  |

## `act`

Does steps in an open session, in order, stopping at the first that fails. Answers like `open`. With no steps, it
looks again.

| Parameter                                            | Type             | Meaning                                                                            |
| ---------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------- |
| `session`                                            | string, required | the id `open` returned                                                             |
| `steps`                                              | string[]         | [steps](flows.md#steps) such as `click:e3`, `fill:e4=hello`, `rightclick:@420,180` |
| `elements`, `screenshot`, `tree`, `full`, `logLevel` |                  | as for `open`                                                                      |

## `close`

| Parameter | Type             | Meaning                                                                           |
| --------- | ---------------- | --------------------------------------------------------------------------------- |
| `session` | string, required | the session to close                                                              |
| `saveAs`  | string           | a flow file to write the steps that worked to, inside the project: `flows/x.yaml` |

## Tool hints

MCP clients use hints to decide which tools to run without asking. facetshot marks `inspect` and `list` as read-only.
`capture`, `check` and `compare` are not read-only, because they build the app, start servers, make test data, and
their `steps` can click anything. The tools that load pages (`capture`, `check`, `compare`, `open` and `act`) are
marked open-world, since a page can reach any site. `act` is also marked destructive, because its steps can do
anything a person could. See [Security](security.md).

Sessions the server opened are closed when it stops: when the agent closes its input, or when the server gets
`SIGINT`, `SIGTERM` or `SIGHUP`.
