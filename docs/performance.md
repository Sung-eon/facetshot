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

One informal measurement, taken once on a 10-core Apple-silicon Mac that was busy with other work at the time. It
shows how much of a run is getting ready; it isn't a benchmark.

| Job                                                                        | First run                                       | Later runs    |
| -------------------------------------------------------------------------- | ----------------------------------------------- | ------------- |
| A large web app: 10 screens × 4 devices × 3 variants = 120 screenshots     | 155 s (incl. a 27 s build and starting the API) | 131 s         |
| The same app on iOS: 10 screens × 3 devices × 3 variants = 90 screenshots  | 390 s (incl. booting simulators)                | 317 s         |
| A small web app: 3 screens × 2 devices × 2 variants = 12 screenshots       | about 3 s                                       | about 1.5 s   |
| SwiftUI scenes: 40 scenes × 3 devices × 3 variants = 360 screenshots (iOS) | about 2 min build + 2.5 min                     | about 2.5 min |

Most of the remaining time in the iOS row is the iPad's large screenshots, taken one after another on one simulator.

## Keeping the machine usable

facetshot is meant to be run often, by several agents at the same time, on the same laptop people work on. Every
run by the same user account goes through one background helper, which keeps one browser and one set of limits
however many terminals or agents are asking:

- At most 4 browser pages are being worked on at once, 2 simulators are booted, and 1 heavy build runs. When the
  machine is busy or short of memory, work goes one at a time. The exact rules are in
  [Shared limits](architecture.md#shared-limits).
- Heavy builds (Xcode, Rust, big bundles) take a lock that other checkouts, other agents and your own scripts can
  share, so two heavy builds never run at once. A Mac window run takes the Mac window lock, since those runs share
  the screen.
- Servers, browsers, simulators and test data are stopped when the background helper has been idle for a while, when
  you run `facetshot daemon stop`, or, with `--no-daemon`, when the run ends, even after Ctrl-C (press it twice to
  stop at once). When and how is in [Lifecycle](architecture.md#lifecycle).
- facetshot makes its own simulators, named `facetshot-<model>`, and never boots, changes or erases any others.

## Making it faster

- Keep the background helper running between runs (the default). `--no-daemon` throws everything away each time.
- Give `web.build` precise `inputs`: everything the build reads, and nothing it doesn't (not `node_modules`, not test
  folders). Otherwise unrelated edits cause rebuilds.
- Add `ready` rules for pages that never go quiet, so they don't wait for the [readiness timeout](configuration.md#webready).
- Run `check` first, and take screenshots only of the screens worth seeing.
- Keep your `default` profile small, and use `-p full` when you need everything.
