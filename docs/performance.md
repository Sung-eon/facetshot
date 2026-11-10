# Speed and machine safety

Most of the time in screenshot work isn't taking pictures, it's getting ready to: building the app, starting servers,
booting simulators, signing in, waiting. facetshot is fast mainly because it does each of those once and keeps the
result. And because agents happily start ten things at once, it's just as careful about not overloading the machine.

## What makes it fast

- **One background helper.** Browsers, servers, simulators and test data stay up between runs, so a second run skips
  straight to the pictures.
- **Builds only when something changed.** A build's inputs are hashed (from git's index, which makes it quick); the
  same inputs mean the build is skipped, even across checkouts for app builds.
- **A production build, not a dev server.** Pages load already compiled, and nothing reloads halfway through a
  picture.
- **One browser, one context per device and variant.** Emulation is set up once per device and variant, not per
  picture, and each context goes from screen to screen in one page.
- **Waiting for the screen, not a timer.** A picture is taken as soon as the page has settled — usually a fraction of a
  second after it loads.
- **Simulators launch the app once.** Screens are opened by deep link and appearance and text size are switched while
  the app runs, instead of launching it for every picture.
- **Snapshots skip the app entirely.** SwiftUI scenes render inside a test, a few hundred milliseconds each.

## What to expect

Measured on a 10-core Apple-silicon Mac on the same day, against the same screens, compared with how the same pictures
were taken before (a dev server or a fresh app launch per picture, a fixed wait, one picture at a time):

| Job                                                                                                  | Before   | facetshot, first run                            | facetshot, next runs |
| ---------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------- | -------------------- |
| A large web app: 10 screens × 4 devices × 3 variants = 120 pictures                                  | 323 s    | 155 s (incl. a 27 s build and starting the API) | 131 s                |
| The same app on iOS: 10 screens × 3 devices × 3 variants = 90 pictures, simulators booted, app built | ~1,250 s | 390 s (incl. booting)                           | 317 s                |
| A small web app: 3 screens × 2 devices × 2 variants = 12 pictures                                    | —        | ~3 s                                            | ~1.5 s               |
| SwiftUI snapshots: 40 scenes × 3 devices × 3 variants = 360 pictures (iOS)                           | —        | ~2 min build + ~2.5 min                         | ~2.5 min             |

Other work was running on the machine during these (load averages of 5 to 240), so expect your own numbers to vary.
Most of the remaining time in the iOS row is the iPad's large screenshots, taken one after another on one simulator.

## Keeping the machine usable

facetshot is meant to be run often, by several agents at the same time, on the same laptop people work on. So:

- **Every run on the machine shares one background helper**, which keeps one browser and the limits below no matter
  how many terminals or agents are asking.
- **Limits.** At most 4 browser pages, 2 simulators and 1 heavy build at once. A project's `limits` can lower the
  first two for itself, never raise them past the machine's; heavy builds share one lock. A Mac app
  window run takes the machine's Mac lock, since those runs share the screen.
- **A brake.** When the machine's load average is above 3× its core count — someone else is compiling, say — work
  goes one at a time until it drops. Runs get slower instead of making the machine unresponsive.
- **Memory.** facetshot asks the system how much memory pressure there is (macOS's memory pressure level, Linux's
  available memory). Under pressure, work goes one at a time; when memory is critical, nothing new starts until it
  eases. The background helper closes and restarts its browsers every 25 runs, and if the helper itself ever grows past
  1.5 GB it finishes its work and exits (the next run starts a fresh one), so a long-lived helper can't slowly eat a
  machine's memory. An unexpected error in the helper still closes everything it started.
- **Machine-wide build lock.** Heavy builds (Xcode, Rust, big bundles) take a lock that other checkouts, other agents
  and your own scripts can share, so two big builds never run at once.
- **Everything started is stopped.** Servers, browsers, simulators and test data go away when the background helper
  goes idle (15 minutes), when you run `facetshot daemon stop`, or — with `--no-daemon` — when the run ends, even if it
  was interrupted with Ctrl-C (press it twice to stop at once). A project nobody has used for 15 minutes lets go of its
  servers and browsers even while other projects keep the helper busy. Closing is bounded: each step gets 10 seconds,
  servers are stopped before browsers so a stuck browser can't keep one alive, and the helper exits within a minute
  of starting to stop whatever hangs; anything it started that is still running is killed as it exits.
- **Only its own simulators.** facetshot makes simulators named `facetshot-<model>` and never boots, changes or erases
  any others.

## Making it faster

- Keep the background helper running between looks (the default). `--no-daemon` throws everything away each time.
- Give `web.build` precise `inputs`: everything the build reads, nothing it doesn't (not `node_modules`, not test
  folders). Otherwise unrelated edits trigger rebuilds.
- Add `ready` rules for pages that never go quiet, so they don't wait for the 15-second timeout.
- Use `check` first; capture only the screens worth seeing.
- Make your `default` profile small; use `-p full` when you need everything.
