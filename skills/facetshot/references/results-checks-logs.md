# Results, checks, readiness and logs

- [What a run writes](#what-a-run-writes)
- [Checks](#checks)
- [When a screenshot was taken too early](#when-a-screenshot-was-taken-too-early)
- [Logs](#logs)
- [Comparing and baselines](#comparing-and-baselines)

## What a run writes

Each run gets `.facetshot/runs/<run id>/` in the project, and `.facetshot/latest` points at the newest. The last 20
runs are kept.

| File                              | What it is                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `<screen>.sheet.jpg`              | the contact sheet: rows are devices, columns are variants                                    |
| `<screen>/<device>.<variant>.png` | each screenshot at full resolution (`.diff.png` beside it after a compare)                   |
| `manifest.json`                   | every screenshot's status, error, timing, findings, notes, diff and log counts               |
| `logs.txt`, `logs.ndjson`         | what the pages, apps and servers logged, per screenshot (text, and one JSON object per line) |
| `summary.md`                      | the summary as Markdown                                                                      |
| `report.html`                     | every screenshot on one page                                                                 |

Screenshot notes say what a screenshot can't show or didn't get: a variant setting the platform didn't apply, a
window the app wouldn't size, a screen that kept changing. Read them before drawing conclusions.

## Checks

| Check      | Finds                                                                      |
| ---------- | -------------------------------------------------------------------------- |
| `console`  | errors the page logged or threw                                            |
| `network`  | requests that failed or answered 4xx/5xx                                   |
| `overflow` | the page is wider than the screen (it scrolls horizontally)                |
| `clipped`  | text cut off by its box, a line clamp, or the screen edge                  |
| `covered`  | buttons and links another element sits on top of                           |
| `images`   | images that failed to load                                                 |
| `blank`    | a page with nothing on it                                                  |
| `targets`  | tap targets smaller than 24×24 on touch devices                            |
| `a11y`     | accessibility problems found by axe-core (contrast, labels, roles); slower |

`capture` runs `console` and `network` unless the config's `checks` (or `--checks`) says more; `check` runs all
but `a11y`, and `checks: ["all"]` adds it. Each finding names the screen, the cells it appeared in, and the element
(a CSS path), so you can find it in the code. Checks read pages, so they run on web pages, Electron, Tauri's
frontend, Storybook and Flutter on the web, not in native windows or simulators. A finding that's expected can only
be left out by leaving that check out; masking an element (`web.mask`) only paints over it in screenshots.

## When a screenshot was taken too early

facetshot takes a screenshot when the network has been quiet (300 ms by default), fonts have loaded, Flutter has
drawn its first frame, and the config's own signals say so; it gives up after 15 s and takes it anyway, with a note
like `Not settled after 15s: still waiting for the network (GET /api/feed)`. Fix that in `facetshot.config.ts`, not
with a delay:

```ts
web: {
	ready: {
		gone: ['.spinner', '[aria-busy=true]'],          // must be hidden
		visible: ['main h1'],                            // must be visible
		routes: { '/feed': { idle: 0, visible: ['article'] } }   // per route; idle: 0 for pages that poll
	}
}
```

Rules also take `when` (a JavaScript expression that must be true) and `timeout`. Native apps settle when they
write their ready file (`readyFile` in the config) or when two screenshots in a row are the same.

## Logs

Each screenshot's lines are in the run's `logs.txt` / `logs.ndjson`, and `inspect` returns them; each session
response carries the lines since the previous one; `facetshot logs <session> --follow` streams a session's.

| Source            | What                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------- |
| `console`, `page` | console messages and uncaught errors in a page                                          |
| `network`         | requests and their status (scripts, styles, images and fonts only at `debug` level)     |
| `navigation`      | addresses the page went to                                                              |
| `server:<name>`   | what the servers facetshot started wrote                                                |
| `main`            | an Electron app's main process: its console, standard output and standard error         |
| `app`             | what a Mac or Tauri app printed to standard output (`info`) and standard error (`warn`) |
| `os_log…`         | what a Mac or iOS app wrote to the system log (`Logger`, `os_log`, `NSLog`)             |

From the system log, `debug` lines are left out, and values the app didn't mark `.public` show as `<private>`. On
iOS, Swift's `print` doesn't reach facetshot; `Logger` does. Tokens, keys, passwords and JWT-shaped strings are
masked in log lines, though not in screenshots or element lists.

## Comparing and baselines

- `compare` (command line: `facetshot diff`) repeats the last request and compares each screenshot with the run
  before. Only changed sheets come back; changed cells have a red outline and a `.diff.png`.
- `facetshot baseline save before-redesign` keeps the latest run under a name; later `compare` with
  `against: "before-redesign"` (or `facetshot <targets> --diff=before-redesign`).
- Comparisons don't fail a run. They show what changed, and judging it is up to you.
