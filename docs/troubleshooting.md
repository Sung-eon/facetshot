# Troubleshooting

Start with `facetshot doctor`. It checks the browsers, the config, ports, Xcode, locks and the background helper, and
gives the fix for each problem. Every error facetshot prints also ends with what to try, after the `→`. If that
isn't enough, look here.

## The screenshot shows a spinner or a half-loaded page

The summary lists screenshots taken before the screen settled, and what facetshot was still waiting for:

```
Taken before the screen settled (4):
  dashboard: Not settled after 15s: still waiting for the network (GET /api/live).
```

- Waiting for the network on a page that polls or keeps saving: set `idle: 0` for that route and say what "loaded"
  looks like instead: `routes: { '/dashboard': { idle: 0, visible: ['.chart svg'] } }`.
- Waiting for something to go away that never does (a hidden live region, a permanent status line): make the `gone`
  selector more specific.
- Waiting for something to appear that doesn't on some devices (a sidebar on phones): move the rule to the routes
  that have it, or use `when` with a condition that covers both.

If the screenshot is wrong but facetshot didn't wait at all, your page needs something facetshot can't see. Add it to
`ready` ([When a page counts as ready](web.md#when-a-page-counts-as-ready)).

## Every page shows the sign-in screen

facetshot isn't signed in. Define a persona with whatever your app checks (a cookie, a header, storage, or a login
flow) and set `web.persona`. See [Personas](auth-and-data.md#personas). If your app signs in a local user only in
development mode, see
[Sign-in that only exists in development](auth-and-data.md#sign-in-that-only-exists-in-development).

## Signing in as a persona didn't work

The persona's `login` flow failed, and the message names the step. Try the flow's steps in a
[session](sessions.md) (`facetshot open <its start>`), fix the flow, and run again. To sign in again before the saved
state expires, delete `.facetshot/auth/<persona>.json`.

## "needs {project}, and nothing provided it"

A target uses a placeholder that your `fixtures.setup` doesn't return. Return it from `setup`, or write the real
value.

## A port is taken

```
Port 5390 (for "web") is taken by something that doesn't answer http://localhost:5390/.
```

Something else is listening there. Find it with the command in the message, stop it, or set the port to another
number or `auto`. If it's a server facetshot started earlier and its run was killed, facetshot takes it over by
itself; if not, `facetshot clean` stops it.

## The build runs every time

Something under the build's `inputs` changes on every run, usually generated files or the build's own output inside
an input folder. Narrow `inputs` to the source folders, or move the output elsewhere.

## Screenshots differ between runs when nothing changed

Fix the clock (`web.clock`), mask what is random or live (`web.mask`), and block what loads differently each time
(`web.block`). See [Keeping screenshots the same](web.md#keeping-screenshots-the-same-from-run-to-run).

## Mac window screenshots fail with a permission error

Turn on Screen Recording for the app that runs facetshot (your terminal, editor or agent) in System Settings →
Privacy & Security → Screen & System Audio Recording, then restart that app.

## Something is still running

`facetshot daemon status` shows what the background helper holds. `facetshot daemon stop` closes it all, and
`facetshot clean` also removes runs, caches, leftover test data and facetshot's simulators.

## It waits for a lock

```
Waiting for ~/.facetshot/locks/build.lock, held by facetshot build ios in /work/app (pid 4312)…
```

Another heavy build is running somewhere on this machine, so facetshot waits its turn. If the process holding the
lock is gone, the lock is taken over automatically. A lock held by a script (with no note saying who holds it) is
left alone; `facetshot doctor` shows it, and how to remove it if you're sure nothing is building.

## "The background helper is busy with older code"

You updated facetshot while the background helper was still running a job with the old version. The new run happens
in your own process instead, outside the shared limits, and the helper is replaced once it's free. Sessions can't be
opened until then. See [Lifecycle](architecture.md#lifecycle).

## Reporting a problem

Include `facetshot doctor`'s output, the command, and the run's `manifest.json`. The logs of servers and builds are
in `.facetshot/logs/`, and the background helper's in `~/.facetshot/daemon.log`. These files are not masked, so check
them for secrets before you share them ([Security](security.md)).
