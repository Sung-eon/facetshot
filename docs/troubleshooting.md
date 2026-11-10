# Troubleshooting

Start with `facetshot doctor`: it checks the usual suspects and tells you the fix for each. Every error facetshot
prints also ends with what to try (after the `→`). If that isn't enough, look here.

## The picture shows a spinner or half-loaded page

The summary lists pictures taken before the screen settled, and what facetshot was still waiting for:

```
Taken before the screen settled (4):
  dashboard: Not settled after 15s: still waiting for the network (GET /api/live).
```

- **Waiting for the network** on a page that polls or keeps saving: set `idle: 0` for that route and say what "loaded"
  looks like instead: `routes: { '/dashboard': { idle: 0, visible: ['.chart svg'] } }`.
- **Waiting for something to go away** that never does (a hidden live region, a permanent status line): make the
  `gone` selector more specific.
- **Waiting for something to show** that doesn't on some devices (a sidebar on phones): move the rule to the routes
  that have it, or use `when` with a condition that covers both.

If the picture is wrong but facetshot didn't wait at all, your page needs something it can't see — add it to `ready`.

## Every page shows the sign-in screen

facetshot isn't signed in. Define a persona with whatever your app checks (a cookie, a header, storage, or a login
flow) and set `web.persona` — see [Who is signed in](web.md#who-is-signed-in). If your app only signs in a local user
in development mode, see [Sign-in that only exists in development](web.md#sign-in-that-only-exists-in-development).

## "needs {project}, and nothing provided it"

A target uses a placeholder your `fixtures.setup` doesn't return. Return it from `setup`, or write the real value.

## A port is taken

```
Port 5390 (for "web") is taken by something that doesn't answer http://localhost:5390/.
```

Something else is listening there. Find it with the command in the message, stop it, or set the port to another
number or `auto`. If it's a server facetshot started earlier and its run was killed, facetshot takes it over by
itself; if not, `facetshot clean` stops it.

## The build runs every time

Something under the build's `inputs` changes on every run — usually generated files or the build's own output inside
an input folder. Narrow `inputs` to the source folders, or move the output elsewhere.

## Pictures differ between runs when nothing changed

Fix the clock (`web.clock`), mask what's random or live (`web.mask`), and block what loads differently each time
(`web.block`). See [Keeping pictures the same](web.md#keeping-pictures-the-same-from-run-to-run).

## Mac window pictures fail with a permission error

Turn on Screen Recording for the app running facetshot (terminal, editor, or agent) in System Settings → Privacy &
Security → Screen & System Audio Recording, then restart that app.

## Something is still running

`facetshot daemon status` shows what the background helper holds. `facetshot daemon stop` closes it all;
`facetshot clean` also removes runs, caches, leftover test data and facetshot's simulators.

## It waits for a lock

```
Waiting for ~/.facetshot/locks/build.lock, held by facetshot build ios in /work/app (pid 4312)…
```

Another heavy build is running somewhere on this machine, so facetshot takes its turn. If the holder is gone, the lock
is taken over automatically. A lock held by a script (no owner note) is left alone; `facetshot doctor` shows it and
how to remove it if you're sure nothing is building.

## Reporting a problem

Include `facetshot doctor`'s output, the command, and the run's `manifest.json`. Logs of servers and builds are in
`.facetshot/logs/`, and the background helper's in `~/.facetshot/daemon.log`.
