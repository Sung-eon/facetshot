---
name: facetshot
description: Look at the app's screens on phone, tablet and desktop, in light, dark and large text, and use them step by step (click, type, right-click, menus) to see what happens and what it logs. Use after changing anything visual, when asked how a screen looks or behaves, when reviewing a design, and when reproducing or clicking through a bug, on web pages, Electron, Tauri, Flutter, iOS simulator and Mac apps.
---

# Seeing the app with facetshot

facetshot takes screenshots of screens on several devices and in several variants at once, returns one contact
sheet per screen with the problems it found and what the app logged, and can click, type and open menus in a screen
kept open. It keeps the browser, servers and simulators running between calls, so a second look takes seconds.

When you're asked how the app looks or behaves (does this overflow on a phone, what gets logged when I press Save,
what does this menu item do), look in the app before you answer from the code, and say what you saw. The code says
what should happen; facetshot shows what does.

## What to use

| You want to                                  | Use                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------- |
| know whether screens you changed are broken  | `check`, then `capture` only the screens with problems               |
| find out what happens when you click or type | a session: `open`, `act` (as many turns as you need), `close`        |
| run the same check again, on every device    | a flow file, listed in a profile's targets: `capture` with `profile` |
| see only what changed since the last capture | `compare`                                                            |
| read a detail a sheet is too small to show   | `inspect`                                                            |

The shell has the same: `facetshot check`, `facetshot <targets>`, `facetshot open | act | close`,
`facetshot -p <profile>`, `facetshot diff`. Steps are written the same way everywhere (`click:e12`,
`fill:label=Email=a@b.co`, `rightclick:@320,120`, `menu:File>Export…`).

## Workflow

1. `list` with `what: "flows"` and `what: "profiles"`: the project may already have the steps or the whole check you
   need. `capture` with only `profile` set runs everything in a profile that has targets.
2. `check` the screens you touched (`targets: ["/settings"]`). It takes no screenshots, so it is cheap.
3. `capture` the screens worth seeing. Read the sheet (rows are devices, columns are variants) rather than opening
   every screenshot.
4. Fix, then `compare`.
5. Close every session you opened, before you answer. When you had to find the steps to a state, `close` it with
   `saveAs: "flows/name.yaml"` and add that file to a profile's targets in `facetshot.config.ts`, so the next check
   includes it.

In a session, each response has the screenshot, the log lines since the last step, and what's on screen with refs
(`e18 button "Save"`). Use the refs from the latest response; they change when the screen does. Pass
`screenshot: false` for steps you don't need to see.

## Keep it small

Every call takes targets × devices × variants screenshots. Start narrow (`devices: ["phone"]`, one or two
variants) and widen only when the narrow look is clean. Other browsers (`browsers: ["webkit"]`) add rows; use them
only when the task is about a browser.

## Rules

- To look at screens, use facetshot rather than a one-off screenshot script, and don't add sleeps. (Tests the project
  keeps, such as Playwright's `toHaveScreenshot`, are a different job.) If facetshot can't reach a state, write a
  flow. If a screen is shot before it's ready, the response says what it was waiting for; fix the ready rule in
  `facetshot.config.ts`.
- When a response says something is missing on the machine or in the config (a permission such as Accessibility or
  Screen Recording, a build that fails, a URL scheme), stop and tell the person what it says to do. Don't retry the
  same call.
- Steps act as the signed-in user. Don't delete, buy, send or publish anything on a live site unless you were asked
  to.
- Read the logs before guessing at a cause: a console error or a failed request usually explains a broken screen.
- Report what you saw honestly: if a sheet shows a problem you didn't fix, say so.

Targets, steps on each platform, flows, ready rules, baselines and results are in [reference.md](reference.md).
