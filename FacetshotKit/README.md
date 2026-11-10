# FacetshotKit

Pictures of SwiftUI screens, taken inside a test process: every scene, on every device, in every variant, written as PNGs
with an index. No app is launched and no reference images are kept — FacetshotKit only takes pictures; comparing and
judging them is the facetshot CLI's job (`../`), or yours.

```swift
import FacetshotKit
import Testing

@MainActor @Suite struct Screens {
    @Test func facetshot() async throws {
        try await Facetshot.run([
            FacetshotScene("Settings/Main") { SettingsView(model: .preview) },
            FacetshotScene("Button/Primary", layout: .sizeThatFits) { PrimaryButton("Save") {} },
        ])
    }
}
```

With no `FACETSHOT_OUT` in the environment, `Facetshot.run` returns at once, so the test passes in every ordinary run.

## Adding it

The package is the facetshot repository itself (its `Package.swift` is at the root). Add it to your test target only:

```swift
.package(url: "https://github.com/facetshot/facetshot", from: "0.1.0"),   // or .package(path: "…/facetshot")
…
.testTarget(name: "MyAppTests", dependencies: ["MyApp", .product(name: "FacetshotKit", package: "facetshot")])
```

Most people never run the commands below themselves: the facetshot CLI runs them for `preview:` targets
(`../docs/swiftui.md`). They are here for using FacetshotKit on its own.

## Running it

|                              | Command                                                                                                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mac (any package)            | `FACETSHOT_OUT=/abs/out swift test --filter Screens`                                                                                                                                                      |
| iOS simulator, build once    | `xcodebuild build-for-testing -scheme <Package>-Package -destination 'platform=iOS Simulator,name=<sim>' -derivedDataPath <dd>`                                                                           |
| iOS simulator, take pictures | `TEST_RUNNER_FACETSHOT_OUT=/abs/out xcodebuild test-without-building -scheme <Package>-Package -destination 'platform=iOS Simulator,name=<sim>' -derivedDataPath <dd> -only-testing:<TestTarget>/Screens` |

`xcodebuild` hands `TEST_RUNNER_<NAME>` to the test process as `<NAME>`; FacetshotKit also reads the prefixed name.

## The environment

| Variable              | Meaning                                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FACETSHOT_OUT`       | Absolute output folder. Absent: do nothing.                                                                                                                                                  |
| `FACETSHOT_LIST=1`    | Write `<out>/scenes.json` (`[{"id","title","tags"}]`) and render nothing.                                                                                                                    |
| `FACETSHOT_SCENES`    | Comma-separated patterns over scene ids. No `*`/`?`: a substring. Otherwise a glob over the whole id: `*` within a `/` segment, `**` across segments, `?` one character. Empty: every scene. |
| `FACETSHOT_DEVICES`   | JSON array of devices (below). Default: a 440×956 @3x iPhone on iOS, a 1280×800 @2x window on macOS.                                                                                         |
| `FACETSHOT_VARIANTS`  | JSON array of variants (below). Default: `light` and `dark`.                                                                                                                                 |
| `FACETSHOT_SETTLE_MS` | The longest a picture waits for its view to stop changing (default 1500).                                                                                                                    |

A device: `{"name":"iphone","width":440,"height":956,"scale":3,"idiom":"phone","orientation":"portrait","horizontalSizeClass":"compact","verticalSizeClass":"regular","safeArea":{"top":62,"bottom":34,"left":0,"right":0}}`.
`idiom` is `phone`, `pad` or `mac`; `orientation` defaults from width and height; size classes default to what iOS would
say (a phone is compact across, and compact up-and-down on its side; an iPad is regular unless narrower than 600 pt; a Mac is regular).

A variant: `{"name":"large","appearance":"light","dynamicType":"accessibility1","locale":"ko-KR","layoutDirection":"rightToLeft"}`.
`dynamicType` is a `DynamicTypeSize` case name (`xSmall` … `xxxLarge`, `accessibility1` … `accessibility5`); unset is `large`.
The CLI's own spellings are read too: `text` (`default`, `large`, `xlarge`, `xxl` → `large`, `accessibility1`, `accessibility3`,
`accessibility5`), `direction` (`ltr`, `rtl`) and `contrast` (`more`, iOS only).

## The output

```
<out>/index.json
<out>/<scene id, "/" → "__">/<device>.<variant>.png
```

`index.json` is `[{"scene","device","variant","path","ms","width","height","error"}]`, sizes in pixels. A scene that throws or
fails to draw has `"path": null` and its `"error"`; the run goes on, and `index.json` is rewritten after every picture, so it
is there even if the process dies part-way. The test fails only when the request cannot be read or the folder cannot be written.

A picture is the whole screen — `width × scale` by `height × scale` — unless the scene says `layout: .sizeThatFits` (the
device's width, the content's height) or `.fixed(width:height:)`.

## Scenes

`FacetshotScene(id, title:, tags:, layout:, devices:, variants:, wait:) { view }`. The view is made anew for each picture.
`devices` keeps a scene to devices by name or idiom (`["phone", "pad"]`), `variants` to variants by name. `wait` is for a
scene that changes on a timer: nothing counts as settled before it. The closure may `throw` — say, when a fixture is missing —
and the picture is recorded as failed.

## How a picture is taken

Each picture hosts the view in a real window at the device's size, applies the variant twice — as SwiftUI environment values
(`colorScheme`, `dynamicTypeSize`, `layoutDirection`, `locale`, size classes) and as UIKit/AppKit traits (`traitOverrides`,
the window's interface style and appearance), so views backed by UIKit or AppKit agree — and then takes pictures every 60 ms
until two in a row are byte-for-byte the same (layout done, `.task` work in, animations over), or until the settle time is up.

- **iOS** — a `UIHostingController` as the root of a `UIWindow`, with the safe area given as `additionalSafeAreaInsets`.
  - _With an app host_ (a test target whose `TEST_HOST` is an app), the window joins the host's window scene and is drawn
    with `drawHierarchy(in:afterScreenUpdates:)`: what the render server shows, so Liquid Glass, materials, sheets and alerts
    are in it. (This path is written but not yet exercised by a project's tests; the package-test path below is.)
  - _Without one_ (a Swift package's tests), there is no window scene and no render server to ask, so the layer
    tree is drawn with `CALayer.render(in:)`. Layout, text, colour, `List`, `ScrollView`, `TextField` and the rest are right;
    **glass and blur are drawn flat, and presentations (sheets, alerts, popovers) and other windows do not appear**. Give a scene
    the content of a sheet rather than the sheet when it should be pictured everywhere.
- **macOS** — an `NSHostingController` in a borderless `NSWindow` that is never put on screen (nothing flashes, no
  screen-recording permission), drawn with `cacheDisplay(in:to:)` into a bitmap at the device's scale. Glass and behind-window
  blur are flat; sheets are laid over the top middle of their window, as macOS shows them. Phone and pad devices on macOS are an
  approximation: SwiftUI is told their size classes, but controls keep the Mac's look and metrics — use the simulator for those.

### Why not swift-snapshot-testing

[swift-snapshot-testing](https://github.com/pointfreeco/swift-snapshot-testing) (1.19.7 at the time of writing) was the
first choice and was weighed against writing the window hosting directly. It was not taken:

1. **It draws no more than this does.** Without a host application its `image(layout:traits:)` strategy renders the layer
   tree too, by its source (`drawHierarchyInKeyWindow: true` needs the host app's key window, which a package test has not). With a host
   app, drawing the window ourselves gives the same picture.
2. **Presentations.** Its view-controller strategy pictures the controller's view; a sheet or alert presented from it lives
   elsewhere in the window. Drawing the window takes what is presented whenever there is somewhere to present it.
3. **Weight.** Its manifest depends on swift-syntax (`509..<605`) and swift-custom-dump; every package that adds FacetshotKit
   would resolve them, and swift-syntax's range can collide with a project's own macros.
4. **Devices come from JSON at run time**, not from its `ViewImageConfig` presets, so its device catalogue would go unused,
   and the macOS half (`NSHostingView`) would have been ours anyway.

`ImageRenderer` is not used for screens: it cannot draw UIKit- or AppKit-backed views (`List`, `ScrollView`, `TextField`).

### `#Preview` discovery

Not built in. [SnapshotPreviews](https://github.com/EmergeTools/SnapshotPreviews) (0.20.0) can enumerate `#Preview`s at
run time, but only through `PreviewsSupport`, a prebuilt binary `xcframework` made against SwiftUI and UIKit interfaces edited
by hand to expose private types (`ViewPreviewSource`, `UIViewPreviewSource`); it reads conformances out of the binary's
`__swift5_proto` section. That is a closed binary tied to each Xcode's private SwiftUI layout, from a tools-version 5.7 package
that also brings FlyingFox and SimpleDebugger — too much to make every FacetshotKit user carry. Scenes are plain values, so a
project that already uses SnapshotPreviews can map them in its own test target (`FacetshotScene`'s documentation shows the dozen lines).

## License

MIT — see `LICENSE`.
