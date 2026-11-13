# facetshot reference for agents

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
`back: true`), and `shot` (a named screenshot). With no `shot`, one screenshot is taken at the end. Each shot is its
own screen in the results (`<flow>.<shot>`). On the command line and in MCP `steps`: `fill:e4=hello`,
`drag:e2>e5`, `scroll:.list=400`, `back`.

An element can be a Playwright selector (CSS, `text=Delete`, `role=button[name='Save']`), a shortcut (`label=Email`,
`placeholder=Search`, `alt=Logo`, `title=Close`, `testid=menu`), a point (`@x,y`, CSS pixels), or in a session a
ref from its latest list (`e12`). A session closed with `saveAs` / `--save` writes its steps as a flow, with each ref
turned into a selector that works in later runs.

## Logs

Every run writes `logs.txt` (for people, a section per screenshot) and `logs.ndjson` (one JSON object per line) next
to its screenshots: console messages, uncaught errors, navigations, requests (assets only at debug level), and the
output of the servers facetshot started. `facetshot logs latest [--level warn] [--json]` prints them; MCP `inspect`
returns one screenshot's lines; each session answer carries the lines since the previous one;
`facetshot logs <session> --follow` streams a session's log.

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
