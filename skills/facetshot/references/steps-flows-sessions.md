# Steps, flows and sessions

- [Steps](#steps)
- [Naming an element](#naming-an-element)
- [Which steps work where](#which-steps-work-where)
- [Flow files](#flow-files)
- [Sessions](#sessions)

## Steps

The same steps are used in flow files, in MCP `steps` and `act`, and on the command line (`--do`, `act`).

| Step                  | In a flow file                            | Inline                                                   | Does                                                          |
| --------------------- | ----------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| click                 | `click: <element>`                        | `click:<element>`                                        | clicks it                                                     |
| double-click          | `dblclick: <element>`                     | `dblclick:<element>`                                     | double-clicks it                                              |
| right-click           | `rightclick: <element>`                   | `rightclick:<element>`                                   | right-clicks it, to open a context menu                       |
| tap                   | `tap: <element>`                          | `tap:<element>`                                          | taps it (touch devices)                                       |
| long press            | `longpress: <element>`                    | `longpress:<element>`                                    | presses and holds it                                          |
| hover                 | `hover: <element>`                        | `hover:<element>`                                        | moves the pointer over it                                     |
| focus                 | `focus: <element>`                        | `focus:<element>`                                        | focuses it                                                    |
| drag                  | `drag: <element>` + `to: <element>`       | `drag:<element>><element>`                               | drags the first onto the second                               |
| fill                  | `fill: <element>` + `with: <text>`        | `fill:<element>=<text>`                                  | replaces a field's text                                       |
| type                  | `type: <text>`                            | `type:<text>`                                            | types into whatever has focus                                 |
| press                 | `press: <key>`                            | `press:<key>`                                            | a key, with modifiers: `Enter`, `Escape`, `Shift+Meta+K`      |
| select                | `select: <element>` + `option: <value>`   | `select:<element>=<value>`                               | picks an option in a `<select>`                               |
| scroll                | `scroll: <pixels>` / `<element>` (+ `by`) | `scroll:600`, `scroll:<element>`, `scroll:<element>=400` | scrolls the page, to an element, or inside it                 |
| wait                  | `wait: <element>`                         | `wait:<element>`                                         | waits until it is visible (up to 15 s)                        |
| pause                 | `wait: <milliseconds>`                    | `wait:500`                                               | waits that long (a plain number; at most 60000)               |
| wait until gone       | `gone: <element>`                         | `gone:<element>`                                         | waits until it is hidden (up to 15 s)                         |
| go to                 | `goto: <path>`                            | `goto:<path>`                                            | opens another address                                         |
| back, forward, reload | `back` or `back: true`                    | `back`                                                   | the browser's buttons                                         |
| menu                  | `menu: File>Export…`                      | `menu:File>Export…`                                      | chooses from a desktop app's menu bar (Electron, Mac windows) |
| screenshot            | `shot: <name>`                            | `shot:<name>`                                            | waits for the screen to be ready, then takes a screenshot     |

Inline, the text after the last `=` is the value, so a value can't contain `=`; use a flow file for that. Steps
that act on an element wait up to 10 seconds for it. Step values aren't filled with placeholders or environment
variables: a sign-in flow holds its credentials as written, so use test accounts.

## Naming an element

On web pages, Electron and Tauri's frontend (anything Playwright drives):

- a ref from a session's latest list: `e12` (`f1e3` inside a frame)
- role and accessible name: `role=button[name="Save"]` (case-insensitive; add `s` after the quote for exact case).
  Prefer this: it survives most layout and style changes.
- shortcuts: `label=Email`, `placeholder=Search`, `alt=Logo`, `title=Close`, `testid=menu`
- `text=Delete`, or any Playwright selector, including CSS (`#save`, `.menu li`)
- a point on the screenshot: `@120,80` (CSS pixels from the top left). When several elements match, the first is used.

In a Mac window (native Mac apps, Flutter on macOS, Tauri's real window), elements come from the system's
accessibility, so CSS has nothing to match: use a ref, `role=button[name="Save"]`, `text=`, `label=` or `title=`
(the whole name, any case), or a point in points from the window's top left. Roles use the web's names (`button`,
`textbox`, `checkbox`, `menuitem`, `link`, `tab`…). A field named only by its placeholder is named by it.

On an iOS simulator: `role=…[name=…]`, `text=`, `#identifier`, a plain accessibility label, or a point in points.

## Which steps work where

| Where                                                | Steps                                                                                                                                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web pages, Electron, Tauri's frontend, Storybook     | all; `menu` only in Electron (its menu bar)                                                                                                                                                     |
| Native Mac apps (Flutter's too), Tauri's real window | all but `longpress`, `back`, `forward` and `reload`; `menu` uses the menu bar                                                                                                                   |
| iOS simulator                                        | `click`/`tap`, `longpress` and `rightclick` (both a long press, the context menu), `drag`, `fill`, `type`, `wait` for an element or a pause in ms, `gone`, `scroll` by pixels (a swipe), `goto` |

In a Mac window, every step first brings the app to the front and makes its window key, so keys reach the focused
element. A step on an element uses the element's own accessibility action (press, show menu) where it has one, so
the pointer isn't moved. A point, a drag, a hover, a double-click, scrolling and typing are real input, and the step
fails rather than reach another app if the app can't come to the front. A point outside the window is refused.
`press` knows letters, digits, punctuation, arrows, Enter, Escape, Tab, Space, Backspace, Delete, Home, End, Page
Up/Down and F1 to F12, with Shift, Meta (Cmd), Control and Alt. A shortcut with Meta that the app's menu bar lists
(`press:Meta+N`) chooses that menu item. In a window with a very large custom view, the element list stops at a
limit and says what it left out.

The iOS steps by role or point, long press and drag are new and haven't been run on every setup; if one fails in
a way that looks like facetshot's fault, say so rather than working around it.

## Flow files

A flow reaches a state no address leads to, and takes screenshots there:

```yaml
# flows/delete-account.yaml
start: /settings/account
steps:
  - click: role=button[name="Delete account"]
  - wait: role=dialog
  - shot: confirm
  - fill: label=Type DELETE to confirm
    with: wrong words
  - click: role=button[name="Delete"]
  - shot: error
```

Each `shot` becomes its own screen in the results (`delete-account.confirm`, `delete-account.error`), each with
its own sheet, and the flow runs from the start once per device and variant. With no `shot`, one screenshot is
taken at the end. `start` can be `app:/path` for app screens. When a step fails, the screenshots after it are
reported as failed with the step and the reason, and the sheet shows how far each device got.

## Sessions

- **What opens:** web pages (paths and URLs, with the project's servers, sign-in, variants and test data, as in a
  run), Electron windows (`open app:/ --on window` launches the app; `close` quits it), Tauri frontends, Tauri's
  real window and native Mac apps (Flutter's too). iOS simulators and Storybook stories take flows, not sessions.
- **One device, one variant** per session. The first response is like every `act` response.
- **Refs** come from the latest response and change when the screen does. `act` with no steps looks again.
- **Limits:** at most six sessions open at once for a user, across all their projects and agents; a session
  closes by itself after 10 idle minutes. Sessions need the background helper (not with `--no-daemon`).
- **Saving:** `close` with `saveAs` writes the steps that worked as a flow, each ref turned into a selector that
  finds the element again (by role and name where it has them); a point is kept as it is, so check it still lands
  right on other devices. Typed text is saved as typed.
- **Keeping evidence:** closing deletes the session's screenshots and log. `close` with `keep: "<folder>"` (a new
  or empty folder) copies them there first; do it when your answer points at a screenshot.
- **Mac windows:** a session locks the screen's pointer only while a step runs, so between steps another run may
  open windows; the session's screenshots are always of its own window.
