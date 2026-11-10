# Sessions: working a page step by step

Pictures and flows answer "what does this look like?". Sometimes you need to find out first: what happens when I
right-click this row, does the menu fit on a phone, what does the page log when I press Save. A **session** keeps one
page open so you, or an agent, can work it one step at a time. After each step you get the picture, the log lines
since the last step, and what on screen can be clicked or typed into.

What to click is up to whoever drives the session. facetshot provides the page, the hands and the eyes.

## From the command line

```sh
$ facetshot open /settings --on phone --as dark
s-3b8ec4 · phone/dark · http://localhost:5173/settings · "Settings"
Picture: .facetshot/sessions/s-3b8ec4/001.png (390×844, CSS pixels)

Logs (2):
  +0.00s INFO  navigation → http://localhost:5173/settings
  +0.00s INFO  network GET /api/me 200 41ms

On screen (6; use #n in a step):
  #1 link "Home" @40,34
  #4 textbox "Name" @195,222 (value "Ada Lovelace")
  #5 checkbox "Send me a weekly summary" @120,272 (checked)
  #6 button "Save" @195,362
```

Then work it with `act`, giving as many steps as you like:

```sh
facetshot act s-3b8ec4 "fill:#4=Grace Hopper" click:#6
facetshot act s-3b8ec4 rightclick:@195,120 --elements     # open a context menu and list its items
facetshot act s-3b8ec4 "click:role=menuitem[name='Copy link']"
facetshot look s-3b8ec4 --full                             # the whole page, without doing anything
facetshot close s-3b8ec4 --save flows/edit-settings.yaml    # keep the steps that worked
```

`facetshot sessions` lists what's open. A session closes by itself after 10 minutes without use
(`FACETSHOT_SESSION_IDLE_MINUTES`). At most 6 are open on a machine at once, because each one is a page with its own
memory.

## Naming what to touch

A step that touches an element can name it three ways:

| Write                                      | Means                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| `#4`                                       | element 4 from the last list (`open` always lists; `act --elements` too) |
| `@195,362`                                 | that point on the picture. Pictures are in CSS pixels, so they match     |
| `role=button[name='Save']`, `text=Save`, … | a Playwright selector, as in [flows](flows.md#selectors)                 |

The list numbers belong to the session: they're renumbered each time the page is listed. When you save a session as
a flow, each `#n` is written as a selector that finds the same element again (by its role and name where it has
them), so the flow plays back in a later run on every device.

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
