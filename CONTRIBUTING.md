# Contributing to facetshot

Please open an issue before a large change, so the approach can be agreed first.
[Architecture](docs/architecture.md) describes how the code is laid out and how the parts talk to each other.

## Setting up

facetshot runs on [Bun](https://bun.sh) 1.3 or newer. From a clone:

```sh
bun install
bun --bun src/cli.ts setup    # the browser the tests use
```

## The three checks

All three must pass before a change is merged:

```sh
bun --bun tsc --noEmit -p .   # types
bun test test                 # unit and end-to-end tests
bun run lint                  # Prettier (bun run format fixes it)
```

Run tests and manual checks with `FACETSHOT_HOME=<a scratch folder>`, so they use a background helper of their own
instead of the one your other projects and agents share.

## Tests that skip

Some tests need something the machine may not have, and skip without it. Their names say what:

- Electron and Tauri tests need the examples' dependencies: `bun install` in `examples/electron` and
  `examples/tauri`.
- Mac window tests need **Screen Recording**; steps and sessions in Mac windows need **Accessibility**. Grant both to
  the app the tests run in (System Settings → Privacy & Security). `facetshot doctor` shows whether they are granted.
- There is no automated iOS simulator test. iOS changes are checked by hand and recorded in
  [docs/status.md](docs/status.md).

## Docs change with the code

A change in behaviour updates the docs in the same pull request: the page in `docs/` that owns the fact
([docs/README.md](docs/README.md) says which page covers what), [docs/status.md](docs/status.md) when what has been
tested changes, and the Agent Skill in `skills/facetshot/` when agents need to know.

## No CI

The repository has no continuous integration. Run the three checks on your own machine before you open a pull
request, and say in it which of the skipped tests you could run.
