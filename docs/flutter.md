# Flutter

A Flutter app draws everything itself, into a canvas on the web and into its own view on macOS and iOS. There are no
HTML elements or native controls to read. What Flutter does publish is its **semantics tree**: the description of the
screen it gives screen readers. facetshot reads that tree, so checks, steps and session refs are meant to work on a
Flutter app the same way they work elsewhere, with no Flutter-specific setup in your app. So far this has been tried
on the web; see [Status](status.md) for macOS and iOS.

Each platform goes through the path facetshot already has for it:

| Flutter build | Taken as                                                    | Guide                                      |
| ------------- | ----------------------------------------------------------- | ------------------------------------------ |
| web           | a web page (`/path` targets)                                | [Web apps](web.md)                         |
| macOS         | a native Mac app (`app:/path` on `mac`)                     | [Desktop apps](desktop.md#native-mac-apps) |
| iOS           | an app on the simulator (`app:/path` on `iphone`, `ipad-…`) | [iOS simulators](ios.md)                   |

[`examples/flutter`](../examples/flutter) is a small app set up for the web and macOS.

## On the web

Flutter's web build is a folder of static files, so facetshot can serve it itself. No server command is needed:

```ts
web: {
	build: {
		cmd: 'flutter build web --release',
		inputs: ['lib', 'web', 'pubspec.yaml'],
		output: 'build/web'
	}
}
```

When a page turns out to be a Flutter app, facetshot does two things before it counts the page as ready:

- It turns on the semantics tree. Flutter leaves it off until a screen reader asks for it, through a hidden "enable
  accessibility" button; facetshot presses that button.
- It waits until Flutter has drawn its first frame, which is when the tree appears.

After that, `check` reads the tree (an element running off the screen shows up as an `overflow` or `clipped`
finding), and a [session](sessions.md) lists the app's buttons and fields with refs. Flutter describes some widgets
differently from HTML: the items of a popup menu, for example, are listed as buttons.

To use paths such as `/settings`, give your app path-based URLs (`usePathUrlStrategy()` from
`flutter_web_plugins`); facetshot's server answers every path with `index.html`.

## On macOS

The macOS build is a native Mac app:

```ts
desktop: {
	kind: 'macos',
	build: {
		cmd: 'flutter build macos --release',
		inputs: ['lib', 'macos', 'pubspec.yaml'],
		output: 'build/macos/Build/Products/Release/my_app.app',
		heavy: true
	}
}
```

facetshot launches the app for each screen and tells it what to show through environment variables
(`FACETSHOT_ROUTE`, `FACETSHOT_APPEARANCE`, and the rest listed under
[Native Mac apps](desktop.md#native-mac-apps)). A few lines in `main()` can follow them, as the example does:

```dart
final route = kIsWeb ? null : Platform.environment['FACETSHOT_ROUTE'];
runApp(MyApp(initialRoute: route ?? '/'));
```

Steps and sessions use macOS's Accessibility interface, which Flutter's macOS embedder answers from its semantics
tree. They need the Accessibility permission ([Permissions](desktop.md#permissions)). What the app prints with
`print` or `debugPrint` is in the [logs](logs.md#apps-outside-the-browser).

Some Flutter versions can't build for macOS with a recent Xcode; see [Status](status.md).

## On iOS

Build the app for the simulator (`flutter build ios --simulator`) and set it up as any iOS app under `apple`, as
[iOS simulators](ios.md) describes. Steps go through XCUITest, which reads the same accessibility information. From a
simulator, facetshot reads the app's lines in the system log ([Logs](logs.md#apps-outside-the-browser)).
