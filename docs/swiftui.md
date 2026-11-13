# SwiftUI scenes

The fastest way to see a SwiftUI screen is not to launch the app at all. facetshot's companion package,
FacetshotKit, renders SwiftUI views inside a test at each device's size and in each variant. Each view you give it
is a **scene**: a name and a view built from sample data. facetshot runs that test and puts the screenshots on contact
sheets with everything else.

Use scenes for layout: how a screen fits on a phone and a tablet, in dark mode, with large Dynamic Type. Use the
[simulator](ios.md) when you need the running app: navigation, sheets, Liquid Glass, data from a server.

SwiftUI scenes need a Mac with Xcode.

## Setup

1. Add FacetshotKit to your package's (or project's) test target. Its `Package.swift` is at the root of the facetshot
   repository:

   ```swift
   // Package.swift
   dependencies: [
       .package(url: "https://github.com/Sung-eon/Facetshot.git", branch: "main")
   ],
   targets: [
       .testTarget(
           name: "MyAppTests",
           dependencies: ["MyApp", .product(name: "FacetshotKit", package: "facetshot")]
       )
   ]
   ```

2. List your scenes and add one test that renders them:

   ```swift
   import FacetshotKit
   import SwiftUI
   import Testing
   @testable import MyApp

   @MainActor
   let scenes: [FacetshotScene] = [
       FacetshotScene("Settings/Account") { AccountView(user: .sample) },
       FacetshotScene("Settings/Empty") { AccountView(user: nil) },
       FacetshotScene("Badge", layout: .sizeThatFits) { Badge(count: 12) }
   ]

   @MainActor
   @Suite struct FacetshotRender {
       @Test func render() async throws {
           try await Facetshot.run(scenes)
       }
   }
   ```

   Nothing is rendered unless facetshot asks for it, so this test passes at once in your normal test runs.

3. Tell facetshot where the test is:

   ```ts
   swift: { package: '.', test: 'MyAppTests/FacetshotRender' }
   ```

## Taking screenshots

```sh
facetshot preview:Settings/Account --on iphone,ipad-landscape --as light,dark,xxl
facetshot 'preview:Settings/*'          # every scene under Settings
facetshot 'preview:**'                  # every scene
```

`*` matches within one part of a scene name and `**` across parts, so `Settings/*` doesn't include
`Settings/Billing/Invoice` but `Settings/**` does.

- iOS devices render in an iOS simulator used only to host the test; the app isn't launched. The test bundle is built
  once and reused until your package's sources change (and only one heavy build runs on the machine at a time).
- Window devices (`mac`, `window`) render on the Mac itself with `swift test`. Phone and tablet sizes on the Mac are
  an approximation: SwiftUI gets their size classes, but controls keep their Mac look.

Variants map to SwiftUI's environment: `dark` to the color scheme, `large`, `xlarge` and `xxl` to the Dynamic Type
sizes `accessibility1`, `accessibility3` and `accessibility5`, `rtl` to the layout direction, and `locale` to the
locale. macOS has no Dynamic Type, so text sizes change nothing on window devices unless your views scale text
themselves.

## What scenes can't show

A test has no app around it, so on iOS:

- Liquid Glass and blur are drawn flat.
- Sheets, alerts, popovers and other windows don't appear (on the Mac, a sheet is drawn over its window).
- There's no server, keychain or app state. Anything a view needs comes from the sample data you give it.

Other snapshot tools have the same limits inside a package test. Take those screens on the [simulator](ios.md) with
`app:` targets instead.

## SwiftUI previews

FacetshotKit doesn't collect `#Preview` blocks automatically. Listing them at run time relies on private SwiftUI types
and a prebuilt binary, which would make every app that uses FacetshotKit depend on both. Scenes are plain values, so
if you already have previews, a few lines turn them into scenes. The [FacetshotKit README](../FacetshotKit/README.md)
explains more.
