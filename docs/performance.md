# Speed and machine safety

Most of the time in screenshot work goes into getting ready: building the app, starting servers, booting
simulators, signing in and waiting. facetshot is fast mainly because it does each of these once and keeps the
result. Since several agents may start runs at the same time, it also limits how much runs at once.

## What makes it fast

- The background helper keeps browsers, servers, simulators and test data running between runs, so a second run goes
  straight to the screenshots.
- A build runs only when its inputs changed. Inputs are hashed from git's index, which is quick, and app builds are
  cached by their inputs, so another checkout of the same code doesn't build again.
- Screenshots are taken of a production build, which is already compiled and doesn't reload partway through.
- There is one browser, with one context per device and variant. Emulation is set up once per device and variant, and
  each context goes from screen to screen in one page.
- A screenshot is taken as soon as the page has settled, usually a fraction of a second after it loads, instead of
  after a fixed wait.
- On a simulator the app is launched once. Screens are opened by deep link, and appearance and text size are changed
  while the app runs.
- SwiftUI scenes are rendered inside a test without the app, a few hundred milliseconds each.

## Example timings

These were measured once, on one 10-core Apple-silicon Mac, on the same day and against the same screens. The
"Earlier scripts" column is the author's own scripts from before facetshot (a dev server or a fresh app launch per
screenshot, a fixed wait, one screenshot at a time). Other work was running on the machine at the time (load averages
between 5 and 240), so treat these as rough examples, not a benchmark.

| Job                                                                                                     | Earlier scripts | facetshot, first run                            | facetshot, next runs |
| ------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------- | -------------------- |
| A large web app: 10 screens × 4 devices × 3 variants = 120 screenshots                                  | 323 s           | 155 s (incl. a 27 s build and starting the API) | 131 s                |
| The same app on iOS: 10 screens × 3 devices × 3 variants = 90 screenshots, simulators booted, app built | about 1,250 s   | 390 s (incl. booting)                           | 317 s                |
| A small web app: 3 screens × 2 devices × 2 variants = 12 screenshots                                    | not measured    | about 3 s                                       | about 1.5 s          |
| SwiftUI scenes: 40 scenes × 3 devices × 3 variants = 360 screenshots (iOS)                              | not measured    | about 2 min build + 2.5 min                     | about 2.5 min        |

Most of the remaining time in the iOS row is the iPad's large screenshots, taken one after another on one simulator.

## Keeping the machine usable

facetshot is meant to be run often, by several agents at the same time, on the same laptop people work on.
[Architecture](architecture.md) explains the parts named here.

- Every run by the same user account goes through one background helper, which keeps one browser and the limits
  below however many terminals or agents are asking. Its state lives in `~/.facetshot` (or `FACETSHOT_HOME`).
- At most 4 browser pages are being worked on at once, 2 simulators are booted, and 1 heavy build runs. The page
  limit counts pages that are taking screenshots or doing steps; open sessions keep their page between steps, and
  up to 6 sessions can be open. A project's [`limits`](configuration.md#limits) can lower the page and simulator
  limits for itself, never raise them. A Mac window run takes the Mac window lock, since those runs share the screen.
- When the 1-minute load average is above 3 times the core count (someone else is compiling, say), work goes one at
  a time until it drops. Runs get slower instead of making the machine unresponsive. Windows has no load average, so
  there this brake is off.
- facetshot asks the system how much memory pressure there is (macOS's memory pressure level, Linux's available
  memory). Under pressure, work goes one at a time; when memory is critical, nothing new starts until it eases. The
  background helper restarts its browsers every 25 runs, and if the helper itself grows past 1.5 GB, it stops once
  it is idle and the next run starts a fresh one.
- Heavy builds (Xcode, Rust, big bundles) take a lock that other checkouts, other agents and your own scripts can
  share, so two heavy builds never run at once.
- Servers, browsers, simulators and test data are stopped when the background helper has been idle for 15 minutes,
  when you run `facetshot daemon stop`, or, with `--no-daemon`, when the run ends, even after Ctrl-C (press it twice
  to stop at once). A project nobody has used for 15 minutes lets go of its servers and browsers even while other
  projects keep the helper busy.
- Stopping has a deadline. Each step gets 10 seconds, servers are stopped before browsers so a stuck browser can't
  keep a server alive, and the helper exits within a minute; anything it started that is still running is killed as
  it exits.
- facetshot makes its own simulators, named `facetshot-<model>`, and never boots, changes or erases any others.

## Making it faster

- Keep the background helper running between runs (the default). `--no-daemon` throws everything away each time.
- Give `web.build` precise `inputs`: everything the build reads, and nothing it doesn't (not `node_modules`, not test
  folders). Otherwise unrelated edits cause rebuilds.
- Add `ready` rules for pages that never go quiet, so they don't wait for the 15-second timeout.
- Run `check` first, and take screenshots only of the screens worth seeing.
- Keep your `default` profile small, and use `-p full` when you need everything.
