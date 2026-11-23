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

Something else is listening there. `facetshot doctor` names the process and, when the background helper started it,
the project it belongs to. Stop it, or set the port to another number or `auto`. If it's a server facetshot started
earlier and its run was killed, facetshot takes it over by itself; if not, `facetshot clean` stops it.

## The build runs every time

Something under the build's `inputs` changes on every run, usually generated files or the build's own output inside
an input folder. Narrow `inputs` to the source folders, or move the output elsewhere.

## Screenshots differ between runs when nothing changed

Fix the clock (`web.clock`), mask what is random or live (`web.mask`), and block what loads differently each time
(`web.block`). See [Keeping screenshots the same](web.md#keeping-screenshots-the-same-from-run-to-run).

## Mac window screenshots fail with a permission error

Turn on Screen Recording for the app that runs facetshot (your terminal, editor or agent) in System Settings →
Privacy & Security → Screen & System Audio Recording, then restart that app.

The permission that counts is that of the app that started the background helper. If `facetshot doctor` says the
permission is there but runs still fail, another app started the helper: run `facetshot daemon stop`, then run again
from the app that has the permission.

## Steps in a Mac window say facetshot "may not use Accessibility"

Pressing, typing and menus in a Mac app's window go through macOS's Accessibility interface. Turn on Accessibility
for the app that runs facetshot in System Settings → Privacy & Security → Accessibility. Screenshots alone don't
need it. `facetshot doctor` shows both permissions; as above, what counts is the app that started the background
helper.

A step that fails because the app didn't come to the front, or that says a point is outside the window, needs the
app's window visible: don't cover it, and don't work at the Mac while the steps run.

## A Mac app's window isn't the size asked for

If the app doesn't size its own window from `FACETSHOT_WINDOW_SIZE`, facetshot asks System Events to resize it. That
needs Accessibility, and macOS asks once for Automation (control of System Events) for the app that runs facetshot.
Allow it, or have the app read `FACETSHOT_WINDOW_SIZE` itself ([Desktop apps](desktop.md#what-the-app-is-told)).

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

## "The background helper is busy with other facetshot code"

The background helper runs different facetshot code than yours (you updated or edited facetshot, or another checkout
of facetshot with other code started it) and is still busy with a run or an open session. Your command waits up to
five minutes for it to finish, then the helper is replaced by one running your code. If it is still busy after that,
a run happens in your own process instead, outside the shared limits, and a session can't be opened until it is
free. Code is compared by content, so two checkouts with the same code share one helper. See
[Lifecycle](architecture.md#lifecycle).

## Many `429 Too Many Requests` in a run's logs

Up to four browser pages load at once, and each screen of a single-page app may call its API a dozen times or more,
all as the same signed-in person. An API with a per-person rate limit can answer `429`, which fills the issue list
and can leave a screen on its loading state. Lower `limits.webPages` for the project
([`limits`](configuration.md#limits)), or raise the rate limit for the local server facetshot starts.

## A command works in your terminal but not in a run

Builds, servers and apps get the background helper's environment, which is that of whatever started it first (your
terminal, or an agent's MCP server), not of the command you just typed. Pass what a command needs in its `env`
([Configuration](configuration.md#settings-that-differ-per-checkout-or-per-person)), or `facetshot daemon stop` and
run again.

## Removing facetshot

`facetshot uninstall` removes facetshot, what it made and what `init --agent` wrote, and asks first. See
[Installing, updating and removing](cli.md#uninstall).

## Reporting a problem

Include `facetshot doctor`'s output, the command, and the run's `manifest.json`. The logs of servers and builds are
in `.facetshot/logs/`, and the background helper's in `~/.facetshot/daemon.log`. These files are not masked, so check
them for secrets before you share them ([Security](security.md)).
