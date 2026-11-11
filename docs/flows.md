# Flows

Some screens have no address: a menu that's open, a confirmation dialog, a form with an error under one field. A
**flow** reaches such a screen with a few steps, and takes a screenshot wherever you say. This page is also the
reference for every step, used by flows, `--do`, sessions and the MCP tools.

```yaml
# flows/delete-account.yaml
start: /settings/account
steps:
  - click: "role=button[name='Delete account']"
  - wait: 'role=dialog'
  - shot: confirm
  - fill: 'input[name=confirm]'
    with: 'wrong words'
  - click: "role=button[name='Delete']"
  - wait: 'text=Type DELETE to confirm'
  - shot: error
```

```sh
facetshot flows/delete-account.yaml --on phone,desktop --as light,dark
```

Each `shot` becomes a screen of its own in the results, here `delete-account.confirm` and `delete-account.error`,
each with its own contact sheet. The flow runs from the start once per device and variant.

## Steps without a file

For a quick look, give the steps on the command line with `--do`. They are played on every target you name, and
each `shot` is a screenshot:

```sh
facetshot /settings/account --do "click:role=button[name='Delete account']" --do "wait:role=dialog" --do shot:confirm
```

Agents pass the same strings in the MCP tools' `steps`, and sessions take them in `act`.

## Steps

The second column is how a step is written in a flow file; the third is the same step on the command line, in
`act`, and in MCP `steps`.

| Step                     | In a flow file                          | Inline                      | Does                                                             |
| ------------------------ | --------------------------------------- | --------------------------- | ---------------------------------------------------------------- |
| click                    | `click: <element>`                      | `click:<element>`           | clicks it                                                        |
| double-click             | `dblclick: <element>`                   | `dblclick:<element>`        | double-clicks it                                                 |
| right-click              | `rightclick: <element>`                 | `rightclick:<element>`      | right-clicks it, to open a context menu                          |
| tap                      | `tap: <element>`                        | `tap:<element>`             | taps it (touch devices)                                          |
| long press               | `longpress: <element>`                  | `longpress:<element>`       | presses and holds it for 0.8 s                                   |
| hover                    | `hover: <element>`                      | `hover:<element>`           | moves the pointer over it                                        |
| focus                    | `focus: <element>`                      | `focus:<element>`           | focuses it                                                       |
| drag                     | `drag: <element>` + `to: <element>`     | `drag:<element>><element>`  | drags the first onto the second                                  |
| fill                     | `fill: <element>` + `with: <text>`      | `fill:<element>=<text>`     | replaces a field's text                                          |
| type                     | `type: <text>`                          | `type:<text>`               | types into whatever has focus                                    |
| press                    | `press: <key>`                          | `press:<key>`               | presses a key, with modifiers: `Enter`, `Escape`, `Shift+Meta+K` |
| select                   | `select: <element>` + `option: <value>` | `select:<element>=<value>`  | picks an option in a `<select>`                                  |
| scroll the page          | `scroll: <pixels>`                      | `scroll:<pixels>`           | scrolls the page by that much                                    |
| scroll to an element     | `scroll: <element>`                     | `scroll:<element>`          | scrolls the element into view                                    |
| scroll inside an element | `scroll: <element>` + `by: <pixels>`    | `scroll:<element>=<pixels>` | scrolls inside a scrollable element                              |
| wait                     | `wait: <element>`                       | `wait:<element>`            | waits until it is visible (up to 15 s)                           |
| wait until gone          | `gone: <element>`                       | `gone:<element>`            | waits until it is hidden (up to 15 s)                            |
| go to                    | `goto: <path>`                          | `goto:<path>`               | opens another address                                            |
| back, forward, reload    | `back` or `back: true`                  | `back`                      | the browser's buttons                                            |
| screenshot               | `shot: <name>`                          | `shot:<name>`               | waits for the screen to be ready, then takes a screenshot        |

A flow with no `shot` step takes one screenshot at the end. Steps that act on an element wait up to 10 seconds for
it.

## Naming an element

Wherever a step takes `<element>`, you can write any of these:

| Write                           | Means                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `role=button[name='Save']`      | an element by its accessible role and name. This is the sturdiest choice                  |
| `text=Forgot password?`         | an element by its visible text                                                            |
| `label=Email`                   | the field with that label                                                                 |
| `placeholder=Search`            | the field with that placeholder                                                           |
| `alt=Logo`                      | the image with that alt text                                                              |
| `title=Close`                   | the element with that `title` attribute                                                   |
| `testid=menu`                   | the element with `data-testid="menu"`                                                     |
| `#submit`, `.card:nth-child(2)` | plain CSS, or any other [Playwright selector](https://playwright.dev/docs/other-locators) |
| `@x,y`                          | a point, in CSS pixels from the top left of the screen                                    |
| `e14`                           | in a [session](sessions.md), the element with that ref in the latest list                 |

`label=`, `placeholder=`, `alt=`, `title=` and `testid=` use Playwright's `getByLabel`, `getByPlaceholder`,
`getByAltText`, `getByTitle` and `getByTestId`. `role=` and `text=` are Playwright's own selector engines. When
several elements match, the first one is used.

## Finding the steps

If you don't know the steps yet, open a [session](sessions.md), try them one at a time, and close it with
`--save flows/name.yaml`. The steps that worked become a flow.

## When a step fails

The screenshots the flow didn't reach are reported as failed, with the step that stopped it:

```
delete-account.error phone/light: step 6 of delete-account ({"click":"role=button[name='Delete']"}) didn't work: Timeout 10000ms exceeded.
```

The contact sheet then shows how far the flow got on each device.

## Flows on apps

On iOS simulators and desktop windows, `goto` and `shot` work through deep links. Steps that touch the screen
(`click`, `tap`, `fill`, `type`) need the app's UI-test runner; see [iOS simulators](ios.md#flows) and
[Desktop apps](desktop.md) for what each platform supports. Electron windows support every step, since they are
driven like a browser.
