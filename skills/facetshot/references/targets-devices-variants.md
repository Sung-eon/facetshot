# Targets, devices, variants and profiles

- [Targets](#targets)
- [Devices](#devices)
- [Variants](#variants)
- [Profiles and batches](#profiles-and-batches)
- [Browsers](#browsers)

Every run takes each target on every device that can show it, in every variant. The number of screenshots is
targets × devices × variants, so name only what the task needs.

## Targets

| Write                                        | Is                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `/settings`                                  | a path in the project's web app (needs a config that says where the app is)       |
| `https://example.com/pricing`                | any web page; no config needed                                                    |
| `app:/inbox`                                 | a screen of the project's app on an iOS simulator or in a desktop window          |
| `story:button--primary`, `story:Button/*`    | Storybook stories, one or a pattern                                               |
| `preview:Settings/Account`, `preview:Book/*` | SwiftUI scenes drawn without launching the app (FacetshotKit)                     |
| `flows/delete-account.yaml`, `flows/*.yaml`  | a flow file: steps that reach a state, then screenshots (`<flow>.<shot>` screens) |
| a short name                                 | an alias from the config's `aliases`, e.g. `settings` for `/settings`             |

Targets can hold placeholders filled with the test data the config's fixtures make, e.g. `/projects/{project}`.
A flow pattern (`flows/*.yaml`) is expanded by facetshot itself, so it works in MCP calls too.

A web target is shown only on web devices, an `app:` target only on iOS and window devices. A flow is shown where
its `start` is: `start: app:/…` on apps; a plain path in a browser, and in the desktop app's window when the config
has one (only there when the config has nothing for the web). If no device you asked for can show a target, the
summary says so ("none of the devices … can show a web target"): add a device of the right kind.

## Devices

| Kind   | Devices (CSS pixels or points)                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| web    | `desktop` 1440×900, `laptop` 1280×800, `tablet-landscape` 1180×820, `tablet-portrait` 820×1180, `phone` 390×844 (touch), `phone-small` 360×740 (touch) |
| iOS    | `iphone` (iPhone 17 Pro Max), `ipad-portrait`, `ipad-landscape`, `ipad-half` (iPad Pro 13-inch)                                                        |
| window | `window` 1280×800, `window-small` 960×640, `mac` 1280×800, `mac-narrow` 1040×640                                                                       |

Groups: `review` and `web` (desktop, both tablets, phone), `ios` (iphone, both iPads), `apple` (the iOS devices,
`ipad-half` and `mac`), `windows` (window, window-small). The project's config can add devices and groups;
`list` with `what: "devices"` shows what this project has.

## Variants

| Variant                  | Changes                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `light`, `dark`          | the colour scheme                                          |
| `large`, `xlarge`, `xxl` | text size (Dynamic Type on iOS; root font size on the web) |
| `contrast`, `forced`     | more contrast; forced colours (web)                        |
| `rtl`                    | right-to-left layout                                       |
| `offline`                | no network (web, Electron)                                 |
| `print`                  | print media (web)                                          |

Groups: `modes` (light, dark, large), `a11y` (light, dark, xxl, contrast). Combine with `+`: `dark+large` is one
variant. Configs can add variants with a locale, time zone or persona (a signed-in user), e.g. `as-viewer`.

Not every platform applies every setting. iOS takes appearance, text size and more contrast; Mac windows take
appearance and text size (the app is told, and has to apply it); Tauri's real window also takes locale, time zone
and reduced motion through its environment. A setting that wasn't applied is named in the screenshot's notes
("Not applied in the simulator: locale."), so read the notes before concluding anything about it.

## Profiles and batches

A profile names devices and variants, and can name targets too. Two are built in:

- `default`: the review devices in light and dark. Used when a call names neither devices nor variants.
- `full`: the same in light, dark and large.

When the default profile's devices can't show a target (it's all web devices, and the target is an app screen),
that target gets the usual devices for its kind instead: the review devices for web pages, and for apps the ones
the config can build or launch (`ios`, `windows` for Electron and Tauri, `mac` for a native Mac app).

A profile with `targets` is a batch: a whole check you run again and again.

```ts
profiles: {
	release: { targets: ['/', '/pricing', 'flows/*.yaml'], on: ['review'], as: ['light', 'dark', 'large'] }
}
```

`capture` with only `profile: "release"` (command line: `facetshot -p release`) takes all of it. Targets you name
replace the profile's. To build one: write or save a flow for each state no address reaches, list them with the
pages in a profile, and check `list` with `what: "profiles"` afterwards.

## Browsers

Web pages are taken in Playwright's Chromium. `browsers` (command line `--browser`) takes them in others:
`webkit` (Safari's engine) and `firefox` (Playwright's builds, installed with `facetshot setup --browser webkit` or
`firefox`), or the installed apps `chrome`, `msedge` and `moz-firefox`. Naming browsers replaces Chromium unless
you list `chromium` too; each browser adds its own rows to the sheet. One device can be pinned to a browser with
`phone@webkit`. Use other browsers only when the task is about a browser.
