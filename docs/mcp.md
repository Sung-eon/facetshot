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
| `diff` (`capture`)    | `--diff`                          |
| `saveAs`              | `--save`                          |
| `logLevel`            | `--level`                         |
| `screenshot: false`   | `--no-screenshot`                 |
| `elements: false`     | `--no-elements`                   |

## `capture`

Takes screenshots and returns a summary and one contact sheet per screen.

| Parameter  | Type                        | Meaning                                                                                                                      |
| ---------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `targets`  | string[], required          | what to look at: `/settings`, `app:/inbox`, `story:button--primary`, `preview:Settings/Account`, `flows/x.yaml`, or an alias |
| `devices`  | string[]                    | devices or groups. Default: the profile's                                                                                    |
| `variants` | string[]                    | variants or groups; `dark+large` combines. Default: the profile's                                                            |
| `profile`  | string                      | a profile from the config                                                                                                    |
| `browsers` | string[]                    | other browsers for web pages: `chromium`, `webkit`, `firefox`, `chrome`, `msedge`, `moz-firefox`. Default: Chromium only     |
| `steps`    | string[]                    | [steps](flows.md#steps) played before each screenshot, written as on the command line                                        |
| `diff`     | string                      | also compare with `previous` or a baseline name                                                                              |
| `images`   | `sheets`, `cells` or `none` | how screenshots come back (below). Default `sheets`                                                                          |

| `images` | Returns                                                                              | Use it for                                                          |
| -------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `sheets` | one sheet per screen, at most 4 (`FACETSHOT_MCP_MAX_IMAGES`)                         | seeing how a screen holds up everywhere                             |
| `cells`  | each screenshot on its own, scaled to 1024 px, at most 8 (`FACETSHOT_MCP_MAX_CELLS`) | a few cells where details matter                                    |
| `none`   | paths only                                                                           | clients that show files themselves, or when only the text is needed |

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

Returns one screenshot from a run, scaled to fit 1568 pixels, with that screenshot's findings, notes and log lines.

| Parameter | Type                      | Meaning                                                                |
| --------- | ------------------------- | ---------------------------------------------------------------------- |
| `screen`  | string, required          | the screen name as the summary shows it                                |
| `device`  | string, required          | the device                                                             |
| `variant` | string, required          | the variant                                                            |
| `run`     | string                    | a run id. Default: the latest run                                      |
| `region`  | `{ x, y, width, height }` | only this part, in CSS pixels or points (scaled by the device for you) |
| `diff`    | boolean                   | return the difference image instead, if the run compared               |

## `list`

| Parameter | Type                                                  | Meaning                         |
| --------- | ----------------------------------------------------- | ------------------------------- |
| `what`    | `devices`, `variants`, `profiles`, `checks` or `runs` | what to list. Default `devices` |

## `open`

Opens a web page and keeps it open as a [session](sessions.md) on one device and variant, with the project's
servers, sign-in and test data. Answers with the session id, a screenshot, the log, and what on screen can be acted
on, with refs.

| Parameter    | Type                               | Meaning                                                                           |
| ------------ | ---------------------------------- | --------------------------------------------------------------------------------- |
| `target`     | string, required                   | a path (`/settings`) or a full URL                                                |
| `device`     | string                             | one device. Default: the profile's first (`desktop` when only `browser` is given) |
| `variant`    | string                             | one variant. Default: the profile's first                                         |
| `browser`    | string                             | the browser, as for `browsers` above. Default Chromium                            |
| `elements`   | boolean                            | list what can be acted on, with refs. Default true                                |
| `screenshot` | boolean                            | return the screenshot. Default true; false answers in text only                   |
| `tree`       | boolean                            | also return the page's accessibility tree as text                                 |
| `full`       | boolean                            | take the whole page, not only the screen                                          |
| `logLevel`   | `debug`, `info`, `warn` or `error` | the least important log lines to return. Default `info`                           |

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
