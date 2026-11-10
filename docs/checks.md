# Checks

Looking at pictures is slow, for people and for models. So while facetshot has each page open, it also reads it for
the problems a reviewer would spot, and lists them as text. Use the list to decide which pictures are worth opening.

```sh
facetshot check /settings /billing          # read only, no pictures — the fastest way to find trouble
facetshot /settings --checks all            # pictures and every check
```

## What's checked

| Check | Finds | Severity |
|---|---|---|
| `console` | errors the page logged or threw | error |
| `network` | requests that failed or answered 4xx/5xx (blocked requests are left out) | error for 5xx and failures, warning for 4xx |
| `overflow` | the page is wider than the screen, so it scrolls sideways — and the element sticking out furthest | error |
| `clipped` | text cut off by its box, a line clamp, or the edge of the screen | warning; info for ellipsis and line clamps, which are usually intended |
| `covered` | buttons and links that something else sits on top of, so a tap at their middle hits the wrong thing | warning |
| `images` | images that failed to load | error |
| `blank` | a page with no text and no images | error |
| `targets` | tap targets smaller than 24×24 on touch devices (links inside running text are exempt, as in WCAG 2.5.8) | warning |
| `a11y` | accessibility problems from [axe-core](https://github.com/dequelabs/axe-core): contrast, labels, roles — serious and critical only | error or warning |

Taking pictures runs `console` and `network` unless your config's `checks` says otherwise. `facetshot check` runs
everything except `a11y`; `--checks all` adds it (it's slower and needs `axe-core` installed, which facetshot
brings along as an optional dependency).

## Reading the results

The summary groups the same finding across devices and variants, so one problem is one line:

```
Found (3):
  ✗ checkout [phone/light, phone/dark] overflow: The page is 48px wider than the screen, so it scrolls sideways. — form.payment > div.row
  ! pricing [4 cells] clipped: Text cut sideways. "Everything in Pro, plus priority support" — li.feature
  ! settings [phone/light] targets: Tap target is 16×16, under 24×24. "×" — header > button.close
```

`✗` is an error, `!` a warning. The part after `—` is where on the page: a short selector path you can search your
code for. Every finding is also in `manifest.json` under its picture, with its check, severity, message, place and
text.

On the contact sheet, a picture with problems carries a small badge with the count.

## Checks are hints

A finding means "look here", not "this is wrong". A horizontal carousel overflows on purpose; a decorative icon
button can be small. If a finding is expected on a page, mask the element or leave that check out with `--checks`.
