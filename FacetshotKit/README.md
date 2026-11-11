# FacetshotKit

FacetshotKit takes screenshots of SwiftUI scenes inside a test process: every scene, on every device, in every
variant, written as PNG files with an index. No app is launched and no reference images are kept. FacetshotKit only
takes the screenshots; comparing and judging them is the job of the facetshot CLI ([`../`](../README.md)), or yours.

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
.package(path: "../facetshot"),   // a clone; or .package(url: "<repository URL>", from: "0.1.0")
…
.testTarget(name: "MyAppTests", dependencies: ["MyApp", .product(name: "FacetshotKit", package: "facetshot")])
```

Most people never run the commands below themselves: the facetshot CLI runs them for `preview:` targets
([SwiftUI scenes](../docs/swiftui.md)). They are here for using FacetshotKit on its own.

## Running it

|                                 | Command                                                                                                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mac (any package)               | `FACETSHOT_OUT=/abs/out swift test --filter Screens`                                                                                                                                                      |
| iOS simulator, build once       | `xcodebuild build-for-testing -scheme <Package>-Package -destination 'platform=iOS Simulator,name=<sim>' -derivedDataPath <dd>`                                                                           |
| iOS simulator, take screenshots | `TEST_RUNNER_FACETSHOT_OUT=/abs/out xcodebuild test-without-building -scheme <Package>-Package -destination 'platform=iOS Simulator,name=<sim>' -derivedDataPath <dd> -only-testing:<TestTarget>/Screens` |

`xcodebuild` passes `TEST_RUNNER_<NAME>` to the test process as `<NAME>`; FacetshotKit also reads the prefixed name.

## The environment

| Variable              | Meaning                                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FACETSHOT_OUT`       | Absolute output folder. Absent: do nothing.                                                                                                                                                  |
| `FACETSHOT_LIST=1`    | Write `<out>/scenes.json` (`[{"id","title","tags"}]`) and render nothing.                                                                                                                    |
| `FACETSHOT_SCENES`    | Comma-separated patterns over scene ids. No `*`/`?`: a substring. Otherwise a glob over the whole id: `*` within a `/` segment, `**` across segments, `?` one character. Empty: every scene. |
| `FACETSHOT_DEVICES`   | JSON array of devices (below). Default: a 440×956 @3x iPhone on iOS, a 1280×800 @2x window on macOS.                                                                                         |
| `FACETSHOT_VARIANTS`  | JSON array of variants (below). Default: `light` and `dark`.                                                                                                                                 |
| `FACETSHOT_SETTLE_MS` | The longest a screenshot waits for its view to stop changing (default 1500).                                                                                                                 |

A device: `{"name":"iphone","width":440,"height":956,"scale":3,"idiom":"phone","orientation":"portrait","horizontalSizeClass":"compact","verticalSizeClass":"regular","safeArea":{"top":62,"bottom":34,"left":0,"right":0}}`.
`idiom` is `phone`, `pad` or `mac`. `orientation` defaults from width and height. Size classes default to what iOS
would report: a phone is compact horizontally, and also compact vertically in landscape; an iPad is regular unless
narrower than 600 points; a Mac is regular.

A variant: `{"name":"large","appearance":"light","dynamicType":"accessibility1","locale":"ko-KR","layoutDirection":"rightToLeft"}`.
`dynamicType` is a `DynamicTypeSize` case name (`xSmall` … `xxxLarge`, `accessibility1` … `accessibility5`); unset is
`large`. The CLI's own spellings are read too: `text` (`default`, `large`, `xlarge`, `xxl` → `large`,
`accessibility1`, `accessibility3`, `accessibility5`), `direction` (`ltr`, `rtl`) and `contrast` (`more`, iOS only).

## The output

```
<out>/index.json
<out>/<scene id, "/" → "__">/<device>.<variant>.png
```

`index.json` is `[{"scene","device","variant","path","ms","width","height","error"}]`, with sizes in pixels. A scene
that throws or fails to draw has `"path": null` and its `"error"`; the run goes on. `index.json` is rewritten after
every screenshot, so it is there even if the process dies partway. The test fails only when the request can't be read
or the folder can't be written.

A screenshot is the whole screen (`width × scale` by `height × scale`) unless the scene says `layout: .sizeThatFits`
(the device's width, the content's height) or `.fixed(width:height:)`.

## Scenes

`FacetshotScene(id, title:, tags:, layout:, devices:, variants:, wait:) { view }`. The view is made anew for each
screenshot. `devices` limits a scene to devices by name or idiom (`["phone", "pad"]`), and `variants` to variants by
name. `wait` is for a scene that changes on a timer: nothing counts as settled before it. The closure may `throw`
(when a fixture is missing, say), and the screenshot is recorded as failed.

## How a screenshot is taken

Each screenshot hosts the view in a real window at the device's size and applies the variant twice: as SwiftUI
environment values (`colorScheme`, `dynamicTypeSize`, `layoutDirection`, `locale`, size classes) and as UIKit or
AppKit traits (`traitOverrides`, the window's interface style and appearance), so views backed by UIKit or AppKit
agree. It then draws the window every 60 ms until two drawings in a row are byte-for-byte the same (layout done,
`.task` work finished, animations over), or until the settle time is up.

- iOS: a `UIHostingController` as the root of a `UIWindow`, with the safe area given as `additionalSafeAreaInsets`.
  - With an app host (a test target whose `TEST_HOST` is an app), the window joins the host's window scene and is
    drawn with `drawHierarchy(in:afterScreenUpdates:)`. That is what the render server shows, so Liquid Glass,
    materials, sheets and alerts are included. This path is written but not yet covered by a project's tests; the
    package-test path below is.
  - Without one (a Swift package's tests), there is no window scene and no render server to ask, so the layer tree is
    drawn with `CALayer.render(in:)`. Layout, text, color, `List`, `ScrollView`, `TextField` and the rest are
    correct, but glass and blur are drawn flat, and presentations (sheets, alerts, popovers) and other windows don't
    appear. When a sheet should be visible everywhere, give a scene the sheet's content instead of the sheet.
- macOS: an `NSHostingController` in a borderless `NSWindow` that is never put on screen (nothing flashes, and no
  Screen Recording permission is needed), drawn with `cacheDisplay(in:to:)` into a bitmap at the device's scale.
  Glass and behind-window blur are flat; sheets are laid over the top middle of their window, as macOS shows them.
  Phone and pad devices on macOS are an approximation: SwiftUI is told their size classes, but controls keep the
  Mac's look and metrics. Use the simulator for those.

### Why FacetshotKit draws the window itself

[swift-snapshot-testing](https://github.com/pointfreeco/swift-snapshot-testing) (1.19.7 at the time of writing) was
considered first and compared with hosting the window directly. FacetshotKit hosts the window itself, for these
reasons:

1. Without a host app it renders the same layer tree this does. Its `image(layout:traits:)` strategy draws the layer
   tree too, according to its source (`drawHierarchyInKeyWindow: true` needs the host app's key window, which a
   package test doesn't have). With a host app, drawing the window directly gives the same result.
2. Presentations. Its view-controller strategy captures the controller's view, while a sheet or alert presented from
   it lives elsewhere in the window. Drawing the window includes whatever is presented, whenever there is somewhere
   to present it.
3. Dependencies. Its manifest depends on swift-syntax (`509..<605`) and swift-custom-dump. Every package that adds
   FacetshotKit would resolve them, and swift-syntax's version range can conflict with a project's own macros.
4. Devices come from JSON at run time, not from its `ViewImageConfig` presets, so its device catalog would go unused,
   and the macOS half (`NSHostingView`) would have had to be written anyway.

`ImageRenderer` isn't used for screens, because it can't draw views backed by UIKit or AppKit (`List`, `ScrollView`,
`TextField`).

### `#Preview` discovery

This isn't built in. [SnapshotPreviews](https://github.com/EmergeTools/SnapshotPreviews) (0.20.0) can list `#Preview`
blocks at run time, but only through `PreviewsSupport`, a prebuilt binary `xcframework` built against SwiftUI and
UIKit interfaces edited by hand to expose private types (`ViewPreviewSource`, `UIViewPreviewSource`); it reads
conformances from the binary's `__swift5_proto` section. That is a closed binary tied to each Xcode's private SwiftUI
layout, in a package that also brings in FlyingFox and SimpleDebugger, which is too much for every FacetshotKit user
to carry. Scenes are plain values, so a project that already uses SnapshotPreviews can map its previews to scenes in
its own test target; `FacetshotScene`'s documentation shows how, in about a dozen lines.

## License

MIT. See `LICENSE`.
