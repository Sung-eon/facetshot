# Flows

Some screens don't have an address: a menu that's open, a confirmation dialog, a form with an error under one field.
A **flow** gets you there with a few steps, and takes a picture wherever you say.

```yaml
# flows/delete-account.yaml
start: /settings/account
steps:
  - click: "role=button[name='Delete account']"
  - wait: "role=dialog"
  - shot: confirm
  - fill: "input[name=confirm]"
    with: "wrong words"
  - click: "role=button[name='Delete']"
  - wait: "text=Type DELETE to confirm"
  - shot: error
```

```sh
facetshot flows/delete-account.yaml --on phone,desktop --as light,dark
```

Each `shot` becomes its own screen in the results — here `delete-account.confirm` and `delete-account.error` — with
a contact sheet each. The flow runs once per device and variant, from the start.

## Without a file

For a quick look, give the steps on the command line instead. They're played on every target you name, and each
`shot` is a picture:

```sh
facetshot /settings/account --do "click:role=button[name='Delete account']" --do "wait:role=dialog" --do shot:confirm
```

Write each step as `<step>:<value>`; `fill` and `select` take `<selector>=<text>`
(`--do "fill:input[name=email]=ada@example.com"`). Agents pass the same strings in the MCP tools' `steps`.

## Steps

| Step | Does |
|---|---|
| `click: <selector>` | clicks the first match |
| `tap: <selector>` | taps it (touch devices) |
| `hover: <selector>` | moves the pointer over it |
| `focus: <selector>` | focuses it |
| `fill: <selector>` + `with: <text>` | replaces a field's text |
| `type: <text>` | types into whatever has focus |
| `press: <key>` | presses a key: `Enter`, `Escape`, `Control+A` |
| `select: <selector>` + `option: <value>` | picks an option in a `<select>` |
| `scroll: <selector>` or `scroll: <pixels>` | scrolls an element into view, or scrolls by that much |
| `wait: <selector>` | waits until it's visible (up to 15 s) |
| `gone: <selector>` | waits until it's hidden |
| `goto: <path>` | opens another address |
| `shot: <name>` | waits for the screen to be ready, then takes a picture |

A flow with no `shot` step takes one picture at the end.

## Selectors

Selectors are Playwright's, so you can write them the way you'd describe the screen to someone:

- `role=button[name='Save']` — by accessible role and name (the sturdiest)
- `text=Forgot password?` — by visible text
- `label=Email` — the field with that label
- `#submit`, `.card:nth-child(2)`, `[data-testid=menu]` — plain CSS

## When a step fails

The pictures the flow didn't reach are reported as failed, with the step that stopped it:

```
delete-account.error phone/light: step 6 of delete-account ({"click":"role=button[name='Delete']"}) didn't work: Timeout 10000ms exceeded.
```

so the contact sheet shows exactly where it went wrong.

## Flows on apps

On iOS simulators and desktop windows, `goto` and `shot` work through deep links. Steps that touch the screen
(`click`, `tap`, `fill`, `type`) need the app's UI-test runner; see [iOS simulators](ios.md) and
[Desktop apps](desktop.md) for what each platform supports. Electron windows support every step, since they're
driven like a browser.
