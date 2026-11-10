# facetshot reference for agents

## Flows

A flow reaches a state a URL can't. Selectors are Playwright's: CSS, `text=Delete`, `role=button[name='Save']`.

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
inside it), `wait` (until visible), `gone` (until hidden), `goto`, `back`, `forward`, `reload`, `shot` (a picture,
named). With no `shot`, the end of the flow is pictured. Each shot is its own screen in the results
(`<flow>.<shot>`). On the command line and in MCP `steps`: `drag:#2>#5`, `scroll:.list=400`, `back`.

Elements can also be `@x,y` (a point in CSS pixels) or, in a session, `#n` from its list. A session closed with
`saveAs`/`--save` writes its steps as a flow, with each `#n` turned into a selector that works in later runs.

## Logs

Every run writes `logs.txt` (for people, a section per picture) and `logs.ndjson` (one JSON object per line) beside
its pictures: console messages, uncaught errors, navigations, requests (assets only at debug), and the output of
the servers facetshot started. `facetshot logs latest [--level warn] [--json]` prints them; MCP `inspect` returns a
picture's lines; each session answer carries the lines since the previous one; `facetshot logs <session> --follow`
streams a session's log.

## When a picture looks unfinished

The summary lists pictures taken before the screen settled and what was still pending, e.g.
`still waiting for the network (GET /api/feed)`. Fix it in `facetshot.config.ts` under `web.ready`:

```ts
ready: {
  gone: ['.spinner', '[aria-busy=true]'],
  routes: { '/feed': { idle: 0, visible: ['article'] } }   // idle: 0 for pages that poll
}
```

## Comparing

- `facetshot diff` or MCP `compare`: the last command again, compared with the run before it.
- `facetshot baseline save before-redesign`, later `facetshot /x --diff before-redesign`.
- A changed cell has a red outline on the sheet and a `.diff.png` beside its picture.

## Results

Each run writes to `.facetshot/runs/<id>/` (and `.facetshot/latest`):

- `<screen>.sheet.jpg` — the contact sheet
- `<screen>/<device>.<variant>.png` — each picture
- `manifest.json` — every cell: status, error, timing, findings, diff ratio, log counts
- `logs.txt`, `logs.ndjson` — what the pages and servers logged
- `summary.md` — what the command printed

Exit codes: 0 all good, 1 some pictures failed, 2 the command or config is wrong, 3 something on this machine is
missing (the message says what), 4 a bug in facetshot.

## Checks

`console`, `network`, `overflow` (sideways scrolling), `clipped` (cut-off text), `covered` (something on top of a
button), `images` (broken), `blank`, `targets` (tap targets under 24×24 on touch devices), `a11y` (axe-core, slower;
only with `--checks all` on `check`).
