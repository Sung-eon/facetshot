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

Steps: `click`, `tap`, `hover`, `focus`, `fill` + `with`, `type`, `press`, `select` + `option`, `scroll` (a
selector or pixels), `wait` (until visible), `gone` (until hidden), `goto`, `shot` (a picture, named). With no
`shot`, the end of the flow is pictured. Each shot is its own screen in the results (`<flow>.<shot>`).

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
- `manifest.json` — every cell: status, error, timing, findings, diff ratio
- `summary.md` — what the command printed

Exit codes: 0 all good, 1 some pictures failed, 2 the command or config is wrong, 3 something on this machine is
missing (the message says what), 4 a bug in facetshot.

## Checks

`console`, `network`, `overflow` (sideways scrolling), `clipped` (cut-off text), `covered` (something on top of a
button), `images` (broken), `blank`, `targets` (tap targets under 24×24 on touch devices), `a11y` (axe-core, slower;
only with `--checks all` on `check`).
