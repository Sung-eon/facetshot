# Flutter

A small Flutter app ("Lantern"): a home screen with three plan cards and a Settings screen with a name field, a Save
button and a context menu (right-click, or long press on a phone). The plan cards sit in a row that never wraps, so
on a phone the last one runs off the screen; that bug is left in for the checks to find.

Run these from this folder inside a facetshot clone, after `bun install` at the clone's root and
`bunx playwright install chromium`. They need the Flutter SDK, and Xcode for `--on mac`. In your own project the
command is `bunx facetshot` instead of `bun --bun ../../src/cli.ts`.

On the web:

```sh
bun --bun ../../src/cli.ts / /settings                          # builds with flutter build web, then two screens
bun --bun ../../src/cli.ts open /settings --on phone            # a session: fill, click and right-click in the app
```

On macOS, the same code as a Mac app:

```sh
bun --bun ../../src/cli.ts app:/ app:/settings --on mac         # builds with flutter build macos first
```

How facetshot reads it:

- Flutter draws into a canvas, so a page has no HTML elements to check or click. facetshot turns on Flutter's
  accessibility tree (the hidden "enable accessibility" button every Flutter web app has), waits for Flutter's first
  frame, and reads that tree. Checks, refs in sessions, and selectors such as `role=button[name="Save"]` all work
  through it (Flutter names popup menu items as buttons).
- On macOS and iOS the app is an ordinary app; facetshot reads it through the system's accessibility, the same way
  as any other Mac or iOS app. The screen to show comes from `FACETSHOT_ROUTE` (see `lib/main.dart`).
- `debugPrint` reaches the web console, and standard output on macOS; both end up in the run's logs.

Built with Flutter 3.24. For the macOS build with a recent Xcode, see [Status and limits](../../docs/status.md).
