# Logs

A screenshot shows what a screen looks like; its log shows what happened while it was on screen. facetshot keeps
both, side by side, for every screenshot of a web page, a Storybook story, an Electron window or a Tauri frontend,
and for every [session](sessions.md).

## What's recorded

| Source        | What                                                                                   |
| ------------- | -------------------------------------------------------------------------------------- |
| `console`     | everything the page logs, at its own level (`console.error` is an error, and so on)    |
| `page`        | uncaught errors, with where they were thrown, and crashes                              |
| `navigation`  | each address the page goes to                                                          |
| `network`     | each request with its status and time; 4xx is a warning, 5xx and failures are errors   |
| `dialog`      | alerts, confirms and prompts, with their text                                          |
| `main`        | an Electron app's main process: its `console` output, from its first window on         |
| `server:name` | new lines in the logs of the servers and builds facetshot started (`.facetshot/logs/`) |

Requests for scripts, styles, images and fonts are kept at the `debug` level, so they don't crowd out the requests
your app makes on purpose. A page keeps its last 5,000 entries, so a page left open for hours can't use more and more memory.

## In a run

Every run writes its logs next to the screenshots, in two files:

- `logs.txt`, for people: a section per screenshot with times from when the page was opened, and the servers'
  output at the end. Debug lines are left out and counted.
- `logs.ndjson`, for programs and agents: one JSON object per line, debug lines included.

```
== settings · phone · light
   +0.004s  INFO   navigation    → http://localhost:5173/settings
   +0.007s  INFO   network       GET /api/me 200 41ms
   +0.412s  WARN   console       The weekly summary setting is deprecated. (/assets/index.js:9)
            (12 more at debug level in logs.ndjson)
```

```json
{
	"at": "2026-11-11T08:40:22.716Z",
	"of": "settings · phone · light",
	"source": "console",
	"level": "warn",
	"text": "The weekly summary setting is deprecated. (/assets/index.js:9)"
}
```

The summary ends with a line pointing at them (`Logs: … (23 lines; 1 warning)`). `report.html` shows them folded at
the end, with a badge on each screenshot that logged errors. The manifest has `logs` for the run and `log` (counts)
for each screenshot.

To read them again later:

```sh
facetshot logs latest                    # the last run, for people
facetshot logs 20261111-084022-36ec --level warn
facetshot logs latest --json | jq 'select(.level == "error")'
```

Agents get a screenshot's log lines with [`inspect`](mcp.md#inspect), next to the screenshot itself.

## Logs and checks

The `console` and `network` [checks](checks.md) turn console errors and failed requests into findings in the run's
summary. Logs are the full record behind them. Use the checks to know that something went wrong, and the logs to
see what happened around it.

## Masking

Tokens, keys, passwords and similar values in log lines are masked before they are written to `logs.txt` and
`logs.ndjson`. The raw server logs in `.facetshot/logs/` are not masked. [Security](security.md#what-is-masked) lists
exactly what is and isn't masked.

## Not yet recorded

Logs from iOS simulator apps and native Mac apps aren't recorded yet. The output of the servers facetshot started is
still recorded for runs on those platforms.
