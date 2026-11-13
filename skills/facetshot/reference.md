# facetshot reference for agents

## Targets

| Write                                     | For                                                 |
| ----------------------------------------- | --------------------------------------------------- |
| `/path` or a full URL                     | a web page                                          |
| `app:/path`                               | an app screen on a simulator or in a desktop window |
| `story:button--primary`, `story:Button/*` | Storybook stories                                   |
| `preview:Book/Page`                       | SwiftUI scenes rendered without a simulator         |
| `flows/name.yaml`, `flows/*.yaml`         | states you reach by clicking and typing (below)     |

Short names from the config (`aliases`) work too, and placeholders such as `{project}` are filled with the test data
facetshot makes for each run.

## Devices, variants and profiles

- Devices: MCP `devices`, shell `--on phone,desktop`. Groups: `review` (the same as `web`), `ios`, `apple`,
  `windows`. `list` with `what: "devices"` shows them all.
- Variants: MCP `variants`, shell `--as dark,large`. `dark+large` is one combined variant.
- A profile names devices and variants, and can name targets too. With neither devices nor variants, the `default`
  profile decides; `full` adds large text. A profile with targets is a batch: `capture` with only `profile` (shell
  `facetshot -p release`) takes every target in it. Targets you give replace the profile's.
- A setting a platform can't apply (a locale on a Mac window, say) is named in the screenshot's notes.

## Where each step works

| Where                                                | Steps                                                                                                                                    | Elements                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Web pages, Electron, Tauri's frontend                | all; `menu:` in Electron (its menu bar)                                                                                                  | any selector below, a point in CSS pixels, a ref                                      |
| Native Mac apps (Flutter's too), Tauri's real window | all but `longpress`, `back`, `forward`, `reload`; `menu:` uses the menu bar                                                              | `role=`, `text=`, `label=`, `title=` (whole name, any case), a point in points, a ref |
| iOS simulator                                        | `click`/`tap`, `longpress` and `rightclick` (context menu), `drag`, `fill`, `type`, `wait`, `gone`, `scroll` by pixels (a swipe), `goto` | `role=`, `text=`, `#id`, a label, a point in points                                   |

Sessions open web pages, Electron and Tauri windows and native Mac apps. Steps and sessions in a Mac window need the
Accessibility permission for the app facetshot runs in; screenshots need Screen Recording. If a response says one is
missing, tell the person. iOS simulators and Storybook stories take flows, not sessions. A session ignores `shot`
steps, and its list holds at most 200 elements, those on screen: scroll to reach the rest.

## Flows

A flow reaches a state that no address leads to.

```yaml
start: /settings
steps:
  - click: "role=button[name='Delete account']"
  - wait: 'role=dialog'
  - shot: confirm
  - fill: 'input[name=confirm]'
    with: 'delete'
  - shot: filled
```

Steps: `click`, `dblclick`, `rightclick`, `tap`, `longpress`, `hover`, `focus`, `drag` + `to`, `fill` + `with`,
`type`, `press` (`Shift+Meta+K`), `select` + `option`, `scroll` (a selector, pixels, or a selector + `by` to scroll
inside it), `wait` (until visible), `gone` (until hidden), `goto`, `back`, `forward`, `reload` (in a file:
`back: true`), `menu` (`File>Export…`, a desktop app's menu bar), and `shot` (a named screenshot). With no `shot`,
one screenshot is taken at the end. Each shot is its own screen in the results (`<flow>.<shot>`). On the command
line and in MCP `steps`: `fill:e4=hello`, `drag:e2>e5`, `scroll:.list=400`, `back`. Inline, the text after the last
`=` is the value, so it can't contain `=`; use a flow file for that. Steps aren't filled with placeholders, so a
sign-in flow holds its password as written.

An element can be a Playwright selector (CSS, `text=Delete`, `role=button[name='Save']`), a shortcut (`label=Email`,
`placeholder=Search`, `alt=Logo`, `title=Close`, `testid=menu`), a point (`@x,y`, CSS pixels), or in a session a
ref from its latest list (`e12`). A session closed with `saveAs` / `--save` writes its steps as a flow, with each ref
turned into a selector that works in later runs.

## Logs

Every run writes `logs.txt` (for people, a section per screenshot) and `logs.ndjson` (one JSON object per line) next
to its screenshots: console messages, uncaught errors, navigations, requests (assets only at debug level), and the
output of the servers facetshot started. Desktop and iOS apps add what the app prints and writes to the system log
(Electron's main process; standard output and `Logger`/`os_log`/`NSLog` on a Mac; the system log on iOS).
`facetshot logs latest [--level warn] [--json]` prints them; MCP `inspect` returns one screenshot's lines; each
session response carries the lines since the previous one (the last 40); `facetshot logs <session> --follow` streams
a session's log.

## When a screenshot looks unfinished

The summary lists screenshots taken before the screen settled and what was still pending, for example
`still waiting for the network (GET /api/feed)`. Fix it in `facetshot.config.ts` under `web.ready`:

```ts
ready: {
  gone: ['.spinner', '[aria-busy=true]'],
  routes: { '/feed': { idle: 0, visible: ['article'] } }   // idle: 0 for pages that poll
}
```

## Comparing

- `facetshot diff` or MCP `compare`: the last command again, compared with the run before it.
- `facetshot baseline save before-redesign`, later `facetshot /x --diff=before-redesign` (MCP `compare` with
  `against`).
- A changed cell has a red outline on the sheet and a `.diff.png` next to its screenshot.

## Results

Each run writes to `.facetshot/runs/<id>/` (and `.facetshot/latest` points at it):

- `<screen>.sheet.jpg`: the contact sheet
- `<screen>/<device>.<variant>.png`: each screenshot
- `manifest.json`: every cell's status, error, timing, findings, diff ratio and log counts
- `logs.txt`, `logs.ndjson`: what the pages and servers logged
- `summary.md`: what the command printed, as Markdown
- `report.html`: everything on one page

Exit codes: 0 all good; 1 some screenshots failed (or a session step didn't work); 2 the command or config is wrong;
3 something on this machine is missing (the message says what); 4 an unexpected error.

## Checks

`console`, `network`, `overflow` (horizontal scrolling), `clipped` (cut-off text), `covered` (something on top of a
button), `images` (broken), `blank`, `targets` (tap targets under 24×24 on touch devices), `a11y` (axe-core, slower).
`capture` runs `console` and `network` unless the config says otherwise; `check` runs all but `a11y`, and
`checks: ["all"]` on `check` adds it.
