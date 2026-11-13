# SwiftUI (FacetshotKit)

A Swift package with three SwiftUI views and a test, `FacetshotRender`, that hands them to
[FacetshotKit](../../FacetshotKit) as scenes. facetshot runs that test and collects the screenshots; no app is built
or launched.

Run these from this folder inside a facetshot clone, after `bun install` at the clone's root; they need Xcode. In
your own project the command is `bunx facetshot` instead of `bun --bun ../../src/cli.ts`.

```sh
bun --bun ../../src/cli.ts 'preview:Trips/*' --on mac                  # on this Mac (swift test)
bun --bun ../../src/cli.ts 'preview:Trips/*' --on iphone --as light,dark  # in an iOS simulator (xcodebuild)
```

Scene ids are paths (`Trips/List`), and `*` stays within one segment: `preview:Trips/*` or `preview:**` names them
all. `scheme` is set in the config because a package with one product gets a scheme named after the package, not
`<Package>-Package`.

In an ordinary `swift test` the test returns at once (there is no `FACETSHOT_OUT`), so it never fails a build.
On macOS, controls keep the Mac's look and ignore Dynamic Type; use the simulator for iOS screens.
