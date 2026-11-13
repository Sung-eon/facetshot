---
name: facetshot
description: Look at an app's real screens and try what they do, on phone, tablet and desktop, in light, dark and large text, with what the app logged. Use it whenever the user asks how a screen looks or behaves, after you change anything visual (CSS, layout, components, copy, themes), to review a design, to reproduce or click through a bug, to check a release or a live site, or to compare before and after, on web pages, Electron, Tauri, Flutter, iOS simulators, Mac apps, Storybook stories and SwiftUI previews. Use it even when the user doesn't say "screenshot", and instead of writing a one-off screenshot or browser script.
---

# facetshot

facetshot shows you an app the way its users see it. Give it screens (targets), and it takes a screenshot of each on
several devices in several variants (light, dark, large text…), puts them on one image per screen (a contact
sheet: rows are devices, columns are variants), reads each screen for common problems, and keeps what the app and
its servers logged. It can also keep one screen open (a session) so you can click, type, right-click and use menus
step by step, seeing a screenshot, the new log lines and a list of what can be acted on after each step.

It builds the app, starts its servers, signs in and makes test data as the project's `facetshot.config.ts` says,
and a background helper keeps browsers, servers and simulators running between calls, so a second look takes
seconds. You reach it through the `facetshot` MCP tools or the `facetshot` command; both do the same things.

## Look before you answer

When you're asked how a screen looks or behaves ("does this card overflow on a phone?", "what gets logged when I
press Save?", "what does Export do?"), look in the app before answering from the code, and say what you saw. The
code says what should happen; facetshot shows what does, including the parts the code can't tell you: the font
that didn't load, the request that failed, the menu that runs off the screen.

## What to use

| You want to                                       | MCP tool                                   | Command line                         |
| ------------------------------------------------- | ------------------------------------------ | ------------------------------------ |
| find out what already exists in the project       | `list` (`what`: flows, profiles, devices…) | `facetshot list flows`               |
| know whether the screens you changed are broken   | `check` (text only, cheapest)              | `facetshot check /settings`          |
| see screens on every device and variant           | `capture`                                  | `facetshot /settings`                |
| read a detail a sheet is too small to show        | `inspect`                                  | open the PNG path from the summary   |
| find out what a click, right-click or typing does | `open`, `act` (many turns), `close`        | `facetshot open`, `act`, `close`     |
| see only what changed since the last capture      | `compare`                                  | `facetshot diff`                     |
| run the same whole check again later              | `capture` with only `profile`              | `facetshot -p <profile>`             |
| understand why a screen looks wrong               | the logs in every response, `inspect`      | `facetshot logs latest --level warn` |

## Workflow

1. **See what's there.** `list` with `what: "flows"` and `what: "profiles"`. The project may already have the steps
   to the state you need, or a profile that checks everything before a release. Reusing them is faster and keeps
   results comparable.
2. **Check first.** `check` the screens you touched. It takes no screenshots, so it costs little, and its findings
   (horizontal scrolling, cut-off text, covered buttons, console errors, failed requests) tell you which screens
   are worth looking at.
3. **Look at what matters.** `capture` those screens and read the sheet rather than every screenshot. Start narrow
   (`devices: ["phone"]`, one or two variants): every call takes targets × devices × variants screenshots, and
   images fill your context quickly. Widen when the narrow look is clean.
4. **Fix, then `compare`.** It repeats the last capture and returns only the sheets that changed, so you see the
   effect of your fix without re-reading everything.
5. **For behaviour, use a session.** `open` a screen, `act` with steps, read each response, and `close` the session
   when you're done, before you answer. An open session holds a browser page or an app window on the person's
   machine, and only six can be open at once. If you had to discover the steps to a state, `close` with
   `saveAs: "flows/<name>.yaml"` and add the flow to a profile's targets in `facetshot.config.ts`, so the next check
   includes it.

## Reading results

- **Sheets:** one per screen. A failed cell says why; a cell with problems is badged; a changed cell (after a
  comparison) has a red outline.
- **Summary text:** counts, the sheet paths, what failed and why, the findings grouped by screen with the element
  they point at, and where the full results are. A failure's reason ends with what to do; read it before retrying.
- **Session responses:** the session id, the screenshot (its size in CSS pixels for pages, points for Mac windows;
  `@x,y` in a step uses the same units), the log lines since the last response, and what can be acted on, each with
  a ref (`e18 button "Save" @195,362`). Refs come from the latest response and change when the screen does.
- **Logs:** console messages, errors, failed requests, navigations, and the output of servers and desktop apps.
  A console error or a failed request usually explains a broken screen better than the code does.

## Rules, and why

- **Use facetshot rather than a one-off screenshot script, and don't add sleeps.** facetshot already waits for the
  network, fonts and the project's own "ready" signals; a script guesses, and its fixed waits make it flaky.
  (Tests the project keeps, such as Playwright's `toHaveScreenshot`, are a different job.) If facetshot can't reach
  a state, write a flow. If a screenshot was taken before the screen settled, the response says what it was still
  waiting for; fix the ready rule in the config instead of adding a delay.
- **Stop when the machine or config is missing something.** A response that names a missing permission
  (Accessibility, Screen Recording), a failed build, no config, or a missing browser won't change if you retry. A
  missing browser or a broken install you can fix yourself with `facetshot setup`
  ([setup-and-troubleshooting.md](references/setup-and-troubleshooting.md#installing-and-fixing-the-install));
  for the rest, tell the person what it says to do.
- **Steps act as the signed-in user.** On a live site they buy, send, delete and publish for real. Do only what you
  were asked to do there.
- **Report what you saw honestly,** including problems you saw and didn't fix, and screenshots that failed.

## References

Read these when the task needs them; each is self-contained.

- [references/mcp-and-cli.md](references/mcp-and-cli.md): every MCP tool and parameter, the matching command-line
  options, output limits and exit codes. Read when a call's parameters aren't obvious, or before scripting the CLI.
- [references/targets-devices-variants.md](references/targets-devices-variants.md): how to name screens, devices,
  variants, profiles (and batches) and browsers. Read when choosing what to capture, or when a target "matches no
  device".
- [references/steps-flows-sessions.md](references/steps-flows-sessions.md): step syntax, naming elements on each
  platform, flow files, which steps work where, and session details. Read before writing steps or a flow.
- [references/results-checks-logs.md](references/results-checks-logs.md): the run folder, what each check means,
  readiness and how to fix unsettled screenshots, logs, comparing and baselines. Read when interpreting results.
- [references/platforms.md](references/platforms.md): web and live sites, Electron, Tauri, native Mac apps,
  Flutter, iOS simulators, Storybook and SwiftUI previews: what each needs and what it can't do. Read when the app
  isn't a plain web page.
- [references/setup-and-troubleshooting.md](references/setup-and-troubleshooting.md): projects without a config,
  the config's main sections (build, serve, services, sign-in, test data), `doctor`, and common errors. Read when a
  run fails before taking screenshots, or the project isn't set up.
