# Sessions

Screenshots and flows answer "what does this look like?". Sometimes you need to find out first: what happens when I
right-click this row, does the menu fit on a phone, what does the page log when I press Save. A **session** keeps one
page open so you, or an agent, can use it one step at a time. After each step you get a screenshot, the log lines
since the last step, and a list of what on screen can be clicked or typed into.

## From the command line

```
$ facetshot open /settings --on phone
s-42cb1d · phone/light · http://localhost:53268/settings · "Lantern"
Screenshot: .facetshot/sessions/s-42cb1d/001.png (390×844, CSS pixels)

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

The first line starts with the session's id, which every following command needs. Open the screenshot to see the
page. Each line under "On screen" is something you can act on: its **ref** (`e14`), its role, its name, and the
point at its center on the screenshot.

Then use the page with `act`, giving as many steps as you like:

```sh
facetshot act s-42cb1d "fill:e14=Grace Hopper" click:e18   # type a name, press Save
facetshot act s-42cb1d rightclick:@120,120                 # open the context menu there
facetshot act s-42cb1d "click:role=menuitem[name='Copy link to settings']"
facetshot look s-42cb1d --full                             # the whole page, without doing anything
facetshot close s-42cb1d --save flows/edit-settings.yaml   # keep the steps that worked
```

Each answer has the same shape as the one from `open`: the new screenshot, the log lines since the last answer (here,
what the page logged when Save was pressed), and the list again:

```
Logs (2):
  +0.00s INFO  console Saving settings…
  +0.00s WARN  console The weekly summary setting is deprecated and will move to Notifications. (/assets/index-BQcy4Hsw.js:9)
```

`--no-screenshot` leaves out the screenshot and `--no-elements` the list, when you don't need them. `--tree` adds
the page's whole accessibility tree (all its text and structure) as text. `facetshot list sessions` lists what's open.
Every option is in the [command reference](cli.md#sessions).

A session closes by itself after 10 minutes without use (`FACETSHOT_SESSION_IDLE_MINUTES` changes this). At most 6
sessions are open at once for your user account, because each one is a page with its own memory.

## Naming what to touch

A step that touches an element can name it by its ref (`e14`), by a point on the screenshot (`@195,362`, in CSS
pixels, the same units as the screenshot), or by a selector. [Naming an element](flows.md#naming-an-element) lists
every form.

Refs come from Playwright's accessibility snapshot of the page, the same snapshot Playwright MCP uses. They last
until the page changes, so use the ones from the latest answer. When you save a session as a flow, each ref is
written as a selector that finds the same element again (by its role and name where it has them), so the flow plays
back in a later run, on every device:

```yaml
start: /settings
steps:
  - fill: role=textbox[name="Name"i]
    with: Grace Hopper
  - click: role=button[name="Save"i]
  - rightclick: '@120,120'
  - shot: end
```

A point (`@120,120`) is saved as it is, so check that it still lands on the right element on other devices, or
replace it with a selector. A flow can only be saved inside the project folder.

## Steps

Every [step](flows.md#steps) works in a session. Steps run in order, and the first one that fails stops the rest.
You still get the screenshot of where the page ended up, with which step failed and why, and `act` exits with 1.

## Logs as you go

Each answer carries the log lines since the previous one: console messages, uncaught errors, navigations, requests
(those for scripts, styles, images and fonts only at `--level debug`), and what the servers facetshot started wrote.
To watch a session's log in another terminal while you or an agent use it:

```sh
facetshot logs s-42cb1d --follow                  # for people
facetshot logs s-42cb1d --follow --json           # one JSON object per line, for programs
facetshot logs s-42cb1d --follow --level warn     # only warnings and errors
```

See [Logs](logs.md) for what is recorded.

## From an agent

The MCP server has three tools for sessions: `open`, `act` and `close` ([MCP tools](mcp.md)). Each answer is the
text above plus the screenshot as an image, so the agent sees the screen, reads the log and picks the next step in one
turn. `act` with no steps looks again. Sessions an agent opened are closed when its MCP server stops, whether the
agent closes its input or the server is ended by a signal.

A session acts as the signed-in persona, and its steps can do anything a person could do on that page. See
[Security](security.md) before pointing sessions at a live site.

## What sessions open

Web pages for now: paths and full URLs, with the project's servers, sign-in, variants and test data, the same as a
run. Sessions on iOS simulators, Mac windows, Electron, Tauri and Storybook stories are planned. Until then, use
[flows](flows.md) for those.

Sessions are kept by the background helper, so they aren't available with `--no-daemon` or `FACETSHOT_NO_DAEMON`.
