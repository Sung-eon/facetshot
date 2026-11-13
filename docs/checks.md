# Checks

Looking at screenshots is slow, for people and for models. So while facetshot has each page open, it also reads the
page for problems a reviewer would notice, and lists them as text. Use the list to decide which screenshots are worth
opening.

```sh
facetshot check /settings /billing          # read only, no screenshots: the fastest way to find problems
facetshot /settings --checks all            # screenshots and every check except a11y
```

## Which checks run

| Command                                    | Checks                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `facetshot <targets>` (taking screenshots) | `console` and `network`, or the config's `checks` if set                    |
| `facetshot check <targets>`                | every check except `a11y`                                                   |
| `--checks all`                             | every check except `a11y` when taking screenshots; every check with `check` |
| `--checks <names>`                         | only the checks you name, e.g. `--checks console,network,a11y`              |

`a11y` is slower and needs `axe-core`, which facetshot installs as an optional dependency. Agents choose checks with
the `checks` parameter of the [MCP `check` tool](mcp.md#check).

## What's checked

| Check      | Finds                                                                                                                                            | Severity                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `console`  | errors the page logged or threw                                                                                                                  | error                                                                  |
| `network`  | requests that failed or answered 4xx or 5xx (blocked requests are left out)                                                                      | error for 5xx and failures, warning for 4xx                            |
| `overflow` | horizontal scrolling: the page is wider than the screen. Names the element that sticks out furthest                                              | error                                                                  |
| `clipped`  | text cut off by its box, a line clamp, or the edge of the screen                                                                                 | warning; info for ellipsis and line clamps, which are usually intended |
| `covered`  | buttons and links with something else on top, so a tap at their center hits the wrong element                                                    | warning                                                                |
| `images`   | images that failed to load                                                                                                                       | error                                                                  |
| `blank`    | a page with no text and no images                                                                                                                | error                                                                  |
| `targets`  | tap targets smaller than 24×24 on touch devices (links inside running text are exempt, as in WCAG 2.5.8)                                         | warning                                                                |
| `a11y`     | accessibility problems found by [axe-core](https://github.com/dequelabs/axe-core), such as contrast, labels and roles; serious and critical only | error or warning                                                       |

## Reading the results

The summary groups the same finding across devices and variants, so one problem is one line:

```
Found (3):
  ✗ checkout [phone/light, phone/dark] overflow: The page is 48px wider than the screen, so it scrolls horizontally. — form.payment > div.row
  ! pricing [4 cells] clipped: Text cut off at the side. "Everything in Pro, plus priority support" — li.feature
  ! settings [phone/light] targets: Tap target is 16×16, under 24×24. "×" — header > button.close
```

`✗` is an error and `!` a warning. The part after the last dash is where on the page the problem is: a short selector
path you can search your code for. Every finding is also in `manifest.json` under its screenshot, with its check,
severity, message, place and text.

On the contact sheet, a screenshot with problems carries a small badge with the count.

## Findings are hints

A finding means "look here", not "this is wrong". A horizontal carousel overflows on purpose, and a decorative icon
button can be small. If a finding is expected on a page, leave that check out with `--checks`. There is no way to
ignore one element yet; `web.mask` only paints over the screenshot, and the checks still see what's under it.
Findings never change the exit code.
