# Sessions: working a page step by step

Pictures and flows answer "what does this look like?". Sometimes you need to find out first: what happens when I
right-click this row, does the menu fit on a phone, what does the page log when I press Save. A **session** keeps one
page open so you, or an agent, can work it one step at a time. After each step you get the picture, the log lines
since the last step, and what on screen can be clicked or typed into.

What to click is up to whoever drives the session. facetshot provides the page, the hands and the eyes.

## From the command line

```
$ facetshot open /settings --on phone
s-42cb1d · phone/light · http://localhost:53268/settings · "Lantern"
Picture: .facetshot/sessions/s-42cb1d/001.png (390×844, CSS pixels)

Logs (2):
  +0.00s INFO  navigation → http://localhost:53268/settings
  +0.00s INFO  network GET /settings 200 3ms

On screen (6; name one by its ref in a step, e.g. click:e7):
  e7 link "Home" @207,34
  e8 link "Pricing" @270,34
  e9 link "Settings" @343,34
  e14 textbox "Name" @195,222 ("Ada Lovelace")
  e16 checkbox "Send me a weekly summary" @27,272 (checked)
  e18 button "Save" @195,362
```

The first line is the session's id. You use it in every command that follows. Open the picture to see the page.
Each line under "On screen" is something you can act on: its **ref** (`e14`), what it is, its name, and its middle
on the picture.

Then work it with `act`, giving as many steps as you like:

```sh
facetshot act s-42cb1d "fill:e14=Grace Hopper" click:e18   # type a name, press Save
facetshot act s-42cb1d rightclick:@120,120                 # open the context menu there
facetshot act s-42cb1d "click:role=menuitem[name='Copy link to settings']"
facetshot look s-42cb1d --full                             # the whole page, without doing anything
facetshot close s-42cb1d --save flows/edit-settings.yaml   # keep the steps that worked
```

Each answer looks like the one from `open`: the new picture, the log lines since the last answer (here, what the page
logged when Save was pressed), and the list again:

```
Logs (2):
  +0.00s INFO  console Saving settings…
  +0.00s WARN  console The weekly summary setting is deprecated and will move to Notifications. (/assets/index-BQcy4Hsw.js:9)
```

`--no-picture` leaves the picture out and `--no-elements` the list, when you don't need them. `--tree` adds the page's
whole accessibility tree, all its text and structure, as text. `facetshot sessions` lists what's open. A session
closes by itself after 10 minutes without use (`FACETSHOT_SESSION_IDLE_MINUTES`). At most 6 are open on a machine at
once, because each one is a page with its own memory.

## Naming what to touch

A step that touches an element can name it three ways:

| Write                                      | Means                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `e14`                                      | the element with that ref in the latest list                            |
| `@195,362`                                 | that point on the picture. Pictures are in CSS pixels, so the two match |
| `role=button[name='Save']`, `text=Save`, … | a Playwright selector, as in [flows](flows.md#selectors)                |

Refs come from Playwright's accessibility snapshot of the page, and they last until the page changes, so use the ones
from the latest answer. When you save a session as a flow, each ref is written as a selector that finds the same
element again (by its role and name where it has them), so the flow plays back in a later run, on every device:

```yaml
start: /settings
steps:
  - fill: role=textbox[name="Name"i]
    with: Grace Hopper
  - click: role=button[name="Save"i]
  - rightclick: '@120,120'
  - shot: end
```

A point (`@120,120`) is saved as it is, so check that it still lands on the right thing on other devices, or replace
it with a selector.

## Steps

Every [flow step](flows.md#steps) works in a session, and these were made with sessions in mind:

| Step                        | Does                                |
| --------------------------- | ----------------------------------- |
| `rightclick:<element>`      | opens the context menu              |
| `dblclick:<element>`        | double-clicks                       |
| `longpress:<element>`       | presses and holds for 0.8 s         |
| `drag:<element>><element>`  | drags from one to the other         |
| `scroll:<element>=<pixels>` | scrolls inside a scrollable element |
| `press:Shift+Meta+K`        | a key with modifiers                |
| `back`, `forward`, `reload` | the browser's buttons               |

Steps run in order. The first one that fails stops the rest. You still get the picture of where the page ended up,
with which step failed and why, and the exit code is 1.

## Logs as you go

Each answer carries the log lines since the previous one: console messages, uncaught errors, navigations, requests
(those for scripts, styles, images and fonts only at `--level debug`), and what the servers facetshot started wrote.
To watch a session's log live in another terminal while you or an agent work it:

```sh
facetshot logs s-3b8ec4 --follow                  # for people
facetshot logs s-3b8ec4 --follow --json           # one JSON object per line, for programs
facetshot logs s-3b8ec4 --follow --level warn     # only warnings and errors
```

See [Logs](logs.md) for what's recorded and how runs keep it.

## From an agent

The MCP server has three tools for sessions: `open`, `act` and `close`. Each answer is the text above plus the
picture as an image, so the agent sees the screen, reads the log and picks the next step in one turn. `act` with no
steps looks again. An agent's sessions are closed when its MCP server stops.

## What sessions open

Web pages for now: paths and full URLs, with the project's servers, sign-in, variants and test data, the same as a
run. Sessions on iOS simulators, Mac windows, Electron, Tauri and Storybook stories are planned. Until then, use
[flows](flows.md) for those.
