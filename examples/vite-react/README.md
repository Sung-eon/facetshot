# Vite + React + Storybook

A three-screen React app ("Lantern") with a Storybook, and the facetshot config that takes screenshots of both.

```sh
bun install
bun --bun ../../src/cli.ts / /pricing /settings     # the app, built with `vite build` and served with `vite preview`
bun --bun ../../src/cli.ts 'story:*'                 # every story, from a static Storybook build
bun --bun ../../src/cli.ts story:Button/*  --on phone --as dark
```

Two things are broken on purpose, for the [checks](../../docs/checks.md) to find (this config turns on `overflow`,
`clipped` and `covered` as well as the default `console` and `network`):

- `/pricing`: three fixed-width plan cards in a row that never wraps. On `phone`, the `overflow` check reports that
  the page is wider than the screen.
- `/settings`: a one-line hint cut off by `overflow: hidden`. The `clipped` check reports it at every size.

`/settings` also has something to try in a [session](../../docs/sessions.md): Save logs an info line and a
warning, and right-clicking the settings opens a small menu.

```sh
bun --bun ../../src/cli.ts open /settings --on desktop
bun --bun ../../src/cli.ts act <id> "click:role=button[name='Save']" rightclick:@320,120
```

Storybook stories are found in `storybook-static/index.json`. `Button/Playground` is tagged `facetshot-skip`, so
patterns leave it out (`story:button--playground` still takes it). The docs page that `autodocs` adds is never taken.
Storybook 8+ doesn't put `parameters` in index.json; facetshot reads `parameters.facetshot` (`skip`, `ready`,
`mask`) from the preview once a story has loaded.

Versions: Vite 8.3, React 19.3, Storybook 10.6 (`@storybook/react-vite`).
