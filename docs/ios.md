# iOS simulators

Some screens can only be seen in the running app: real navigation, sheets, Liquid Glass, data from your server. For
these, facetshot opens the screen in the iOS simulator by deep link and takes the simulator's screenshot. For layout
checks that don't need the app running, [SwiftUI scenes](swiftui.md) are much faster.

iOS targets need a Mac with Xcode.

## Setup

```ts
apple: {
	bundleId: 'com.example.myapp',
	scheme: 'myapp',
	ios: {
		build: {
			cmd: 'xcodebuild -project MyApp.xcodeproj -scheme MyApp -configuration Debug -destination "generic/platform=iOS Simulator" -derivedDataPath .facetshot/derived-ios CODE_SIGNING_ALLOWED=NO',
			inputs: ['MyApp', 'MyApp.xcodeproj'],
			output: '.facetshot/derived-ios/Build/Products/Debug-iphonesimulator/MyApp.app',
			heavy: true
		}
	},
	env: { API_URL: '{services.api.url}' },
	readyFile: true
}
```

- `scheme` is the URL scheme your app handles. `app:/inbox/42` opens `myapp:///inbox/42`; set
  `deepLinkStyle: 'host'` if your app expects `myapp://inbox/42`.
- `ios.build` builds the app when its inputs change. `heavy: true` means only one such build runs on the machine at a
  time. Built apps are also kept in `~/.facetshot/cache/apps/`, keyed by their inputs, so another checkout of the same
  code doesn't build again. If you build the app yourself, give its path as `ios.app` instead.
- `env` is passed to the app at launch. [Placeholders](auth-and-data.md#placeholders) work, so the app can find a
  server facetshot started.

`facetshot init` doesn't write an `apple` section yet, so add it by hand. Then:

```sh
facetshot app:/inbox app:/settings --on iphone,ipad-portrait,ipad-landscape --as light,dark,large
```

## What happens

1. The first time it needs them, facetshot makes simulators of its own, such as `facetshot-iphone-17-pro-max`. It
   never boots, changes or erases a simulator it didn't make.
2. It boots them (at most two at a time), installs the app if it changed, sets the status bar to 9:41 with full
   bars, and launches the app once per simulator.
3. For each variant it changes the simulator's appearance, text size and contrast while the app runs. For each
   screen it opens the deep link and waits until the screen is ready.
4. It takes the simulator's screenshot.

While there are only a few devices, each gets a simulator of its own, so the iPad in portrait and in landscape are
taken in parallel, and a simulator that finishes early hands its slot to the next. Opening deep links, rotating and
playing [flow](flows.md) steps go through a small UI-test runner that facetshot builds once and keeps.

## When a screen counts as ready

Without help from your app, facetshot waits until two screenshots in a row, a quarter of a second apart, are the
same (for up to 8 seconds). That works, but your app knows better when it has finished loading. With
`readyFile: true`, facetshot gives the app a path in `FACETSHOT_READY_FILE`. Write any file there once the screen has
its data and has nothing left to load, and facetshot takes the screenshot right away (after a short wait for
animations to stop):

```swift
#if DEBUG
if let path = ProcessInfo.processInfo.environment["FACETSHOT_READY_FILE"] {
    FileManager.default.createFile(atPath: path, contents: nil)
}
#endif
```

facetshot removes the file before every screen, so write it again after each navigation.

## Variants on iOS

| Variant                  | How                                                                         |
| ------------------------ | --------------------------------------------------------------------------- |
| `light`, `dark`          | the simulator's appearance, changed while the app runs                      |
| `large`, `xlarge`, `xxl` | Dynamic Type: accessibility medium, extra large and extra-extra-extra large |
| `contrast`               | Increase Contrast                                                           |

Locale, right to left, personas, offline and reduced motion aren't applied on the simulator yet; the screenshot's
notes say so. If you need them now, pass what your app needs through `env` and variants of your own.

## iPad in Split View

The `ipad-half` device takes the app at half the screen's width. A simulator can't be put into Split View from
outside, so facetshot tells the app the width in points with `FACETSHOT_SPLIT_WIDTH` at launch, and crops the
screenshot to that half. To support this, lay the app out at that width in debug builds. The screenshot's notes say
that the app drew itself at that width.

## Flows

On the simulator, flows support `goto` and `shot` through deep links, and `tap`, `click`, `fill`, `type`, `wait`,
`gone` and `scroll` through the runner, which finds elements by accessibility label or identifier. Start the flow
with `start: app:/…`.

## Each screen starts where the last one left off

The app is launched once per simulator, and screens are opened one after another by deep link. If opening a deep link
in your app doesn't close a sheet or alert that the previous screen left open, the next screenshot shows that sheet.
That is usually a real bug (a user tapping a link would see the same), and the screenshot makes it visible.
