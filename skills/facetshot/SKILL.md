---
name: facetshot
description: Look at the app's screens on phone, tablet and desktop, in light, dark and large text, before calling UI work done. Use after changing anything visual, when reviewing a design, or when reproducing a layout bug. Never write your own screenshot script.
---

# Seeing the app with facetshot

facetshot takes pictures of screens on several devices and in several variants at once, and hands back one
contact sheet per screen plus a short list of problems it found. It keeps the browser, servers and simulators
running between calls, so a second look takes seconds.

## The loop

1. **Check first, it's cheap.** Read the screens you touched for problems, without pictures:
   - MCP: `check` with `targets: ["/settings"]`
   - shell: `facetshot check /settings`
2. **Look at what matters.** Take pictures of the screens worth seeing:
   - MCP: `capture` with `targets: ["/settings", "/settings/profile"]`
   - shell: `facetshot /settings /settings/profile`
     You get one sheet per screen: rows are devices, columns are variants. Read the sheet; don't open every picture.
3. **Fix**, then **compare** to see only what changed:
   - MCP: `compare` (repeats your last capture)
   - shell: `facetshot diff`
4. If a sheet is too small to judge a detail, capture with `images: "cells"` for a few cells, or **inspect** one cell (MCP `inspect` with screen, device, variant, and
   optionally a region), or open the PNG path from the summary. `inspect` also returns what that page logged.

## Working a page step by step

To find out what happens when you click, right-click, type or scroll — rather than picture a state you already know
how to reach — open a session:

- MCP: `open` with `target: "/settings"` (and one `device`, one `variant`) → then `act` with `steps`, as many turns as
  you need → `close` (with `saveAs: "flows/name.yaml"` to keep the steps as a flow).
- shell: `facetshot open /settings --on phone`, `facetshot act <id> click:e18`, `facetshot close <id> --save flows/x.yaml`.

Each answer has the picture, the log lines since the last step, and what's on screen with refs (`e18 button "Save"`).
Name what to touch by its ref from the latest answer (`click:e18`; refs change when the page does), a point on the
picture (`rightclick:@320,120`, CSS pixels), or a selector (`click:role=button[name='Save']`). Pass
`picture: false` for steps you don't need to see. Close sessions when you're done.

## Targets

| Write                                     | For                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `/path` or a full URL                     | a web page                                                             |
| `app:/path`                               | an app screen on a simulator or a desktop window (opened by deep link) |
| `story:button--primary`, `story:Button/*` | Storybook stories                                                      |
| `preview:Book/Page`                       | SwiftUI scenes rendered without a simulator                            |
| `flows/name.yaml`                         | a state you reach by clicking and typing (see reference.md)            |

To see a menu, dialog or half-filled form, add steps (MCP `steps`, shell `--do`):
`["click:role=button[name='Delete']", "wait:role=dialog", "shot:confirm"]`.

Short names from the project's config (`aliases`) work too, and `{page}`-style placeholders are filled with the
test data facetshot makes for each run.

## Narrowing

- Devices: `--on phone,desktop` (MCP `devices`). Groups: `web`, `ios`, `review`. `facetshot list devices`.
- Variants: `--as dark,large` (MCP `variants`). `dark+large` is one combined variant. `facetshot list variants`.
- With neither, the project's `default` profile decides (usually its design-review set).
- Browsers: Chromium unless asked. When the task is about another browser, add it: `--browser webkit` (Safari's
  engine), `firefox`, or the installed `chrome`, `msedge`, `moz-firefox` (MCP `browsers`, or `browser` on `open`).
  Each browser adds rows, so don't add them by default.

## Rules

- Don't write screenshot scripts, start browsers yourself, or add sleeps. If facetshot can't reach a state, write a
  flow file; if a screen isn't ready when shot, the summary says what it was waiting for — fix the ready rule in
  `facetshot.config.ts`.
- Don't leave things running: close your sessions, and facetshot stops what it started when it goes idle.
  `facetshot clean` removes everything, including test data.
- Read the logs before guessing at a cause: a console error or a failed request usually says why a screen looks
  wrong (`inspect`, an `act` answer, or `facetshot logs latest`).
- A failed picture's reason ends with what to do. Read it before retrying.
- Report what you saw honestly: if a sheet shows a problem you didn't fix, say so.

More: [reference.md](reference.md) — flows, ready rules, baselines, the manifest, exit codes.
