# Web apps

This page covers how facetshot finds your web app, how it decides a page is ready, how to keep screenshots the same
from run to run, and which browsers it can use. Signing in, API servers and test data are in
[Sign-in, servers and test data](auth-and-data.md).

## Where your app is

There are two ways to tell facetshot where your app runs.

You run the app, and facetshot visits it. Set `baseURL`, and paths like `/settings` go there:

```ts
web: {
	baseURL: 'http://localhost:3000';
}
```

Or facetshot builds and starts the app. Give it a build and a server:

```ts
web: {
	build: {
		cmd: 'bunx --bun vite build',
		inputs: ['src', 'public', 'index.html', 'vite.config.ts', 'package.json'],
		output: 'dist'
	},
	serve: { cmd: 'bunx --bun vite preview --port {port} --strictPort', port: 'auto' }
}
```

The commands are your app's own; use whatever your project builds and serves itself with.

- The build runs only when something under `inputs` changed. facetshot hashes their contents (in a git checkout it
  reads git's index, so this is fast even for big projects). If `output` is missing, it builds again.
- The server starts once and stays up between runs. After a rebuild it restarts, so you never look at old code.
- `port: 'auto'` picks a free port. Use a fixed number when something else needs to know it, such as an API that only
  accepts requests from a known origin ([complete example](auth-and-data.md#a-complete-example-web-app-and-api)).
- If the build writes plain static files (a single-page app, or [Flutter](flutter.md)'s `build/web`), leave `serve`
  out. facetshot serves the `output` folder itself, answering paths that aren't files with `index.html`, so the
  app's own routes work.

### Why a build and not your dev server

A dev server compiles each page the first time it's opened and rebuilds after every edit, which makes the first
screenshots slow and sometimes catches a page in the middle of a reload. A production build is compiled once, loads
fast, and looks like what users get. If your app has no production build you can run locally, a dev server works
too: put its command in `serve`.

### A site that's already live

For a quick look at a staging or production site, give full URLs. No config is needed:

```sh
facetshot https://app.example.com/pricing https://app.example.com/docs --on phone,desktop
```

To use your config's personas, variants and checks against a live site, let an environment variable choose where
`baseURL` points. `baseURL` wins over `build` and `serve`, so nothing is built or started for the web app:

```ts
import { defineConfig } from 'facetshot';
import { makeTestData, removeTestData } from './facetshot/test-data.ts';

const live = process.env.SITE; // e.g. SITE=https://staging.example.com

export default defineConfig({
	web: { baseURL: live, build: { … }, serve: { … } },
	services: live ? {} : { api: { … } },
	fixtures: live ? undefined : { setup: makeTestData, remove: removeTestData }
});
```

Some things are different on a live site:

- A sign-in that only exists in development isn't there. Use a persona with a `login` flow or a saved
  `storageState` file ([Personas](auth-and-data.md#personas)), for a test account, not a real person's.
- Whatever `fixtures.setup` creates lands in the live database. That is why the example leaves test data (and local
  services) out when `SITE` is set. Point at pages that already exist instead.
- Every screenshot is a real page load, counted by the site's rate limits, analytics and alerting. Narrow the run
  with `--on`, `--as` and a short list of screens.

To see how your local build differs from what users have now, save screenshots of the live site as a baseline and
compare ([Comparing](comparing.md)):

```sh
SITE=https://app.example.com facetshot /pricing /docs
facetshot baseline save live
facetshot /pricing /docs --diff=live
```

[Security](security.md) has more on what a run or an agent can do to a live site.

## When a page counts as ready

facetshot takes a screenshot when all of these are true, checked every 50 ms:

1. The page has loaded and its fonts have finished loading.
2. No request has been in flight for `idle` milliseconds (300 by default). WebSockets, event streams and requests
   open for more than 10 seconds (long polling) don't count.
3. Nothing in `gone` is visible, and everything in `visible` is.
4. The `when` expression, if there is one, is true.

Then it waits for two painted frames and takes the screenshot with animations stopped and the text cursor hidden.

```ts
web: {
	ready: {
		gone: ['.spinner', '.skeleton', '[aria-busy=true]'],
		routes: {
			'/editor/*': { idle: 0, visible: ['.editor[contenteditable]'] },
			'/reports/**': { timeout: 30000 }
		}
	}
}
```

Rules under `routes` apply to paths matching the pattern (`*` within one path segment, `**` across segments) and add
to the general ones. Set `idle: 0` for pages that never stop talking to the server, such as editors that save
automatically and live dashboards.

If a page isn't ready after `timeout` (15 seconds by default), facetshot takes the screenshot anyway and says what it
was still waiting for:

```
Taken before the screen settled (2):
  editor: Not settled after 15s: still waiting for the network (PUT /docs/42/autosave).
```

## Keeping screenshots the same from run to run

Screenshots should change only when your UI does. facetshot already turns off animations, blocks service workers and
emulates `prefers-reduced-motion`. These settings help with the rest:

```ts
web: {
	clock: '2026-01-15T10:30:00Z',     // "3 minutes ago" stays "3 minutes ago"
	mask: ['.avatar', 'time'],         // painted over in every screenshot
	storage: { 'intro-seen': '1' },    // first-run dialogs, cookie banners
	block: ['**/analytics/**'],        // requests to stop
	rewrite: [{ from: 'https://cdn.example.com', to: 'http://localhost:4001' }],
	css: '.chat-widget { display: none !important }'
}
```

## Large text and other variants on the web

Browsers have no "larger text" setting to emulate, so `large`, `xlarge` and `xxl` set the root font size to 125%,
150% and 200%. That is what a person who raises their browser's default font size gets, and it's what layouts sized
in `rem` respond to. If your app scales text differently, change the sizes:

```ts
web: { textSizes: { large: '112.5%', xxl: '175%' } }
```

The other variants use the browser's own emulation: `dark` sets `prefers-color-scheme`, `contrast` sets
`prefers-contrast: more`, `forced` turns on forced colors, `rtl` sets `dir="rtl"` on the page, `offline` cuts the
network, `print` uses print media, and `locale` and `timezone` set the browser's language and time zone.

## Other browsers

Screenshots are taken in Playwright's Chromium unless you ask for other browsers, for one run:

```sh
facetshot /pricing --browser webkit                # every web device in WebKit, Safari's engine
facetshot /pricing --browser chromium,webkit,chrome
facetshot /pricing --on phone,phone@webkit         # or name the browser per device
facetshot open /pricing --on phone --browser chrome
```

Each browser gets rows of its own on the sheet (`phone`, `phone@webkit`, `phone@chrome`), so the differences are side
by side. Agents pass `browsers` to `capture`, `check` and `compare`, and `browser` to `open`
([MCP tools](mcp.md)). To make another browser the default for a project, set `web.browser` in the config.

| Name          | What it is                                               | Before first use                   |
| ------------- | -------------------------------------------------------- | ---------------------------------- |
| `chromium`    | Playwright's build of Chromium (the default)             | `bunx playwright install chromium` |
| `webkit`      | Playwright's build of WebKit, the engine inside Safari   | `bunx playwright install webkit`   |
| `firefox`     | Playwright's build of Firefox                            | `bunx playwright install firefox`  |
| `chrome`      | the Google Chrome installed on this machine              | nothing, if Chrome is installed    |
| `msedge`      | the Microsoft Edge installed on this machine             | nothing, if Edge is installed      |
| `moz-firefox` | the Firefox app installed on this machine (experimental) | nothing, if Firefox is installed   |

`facetshot doctor` lists which of these this machine can start.

Playwright's builds of WebKit and Firefox are close to Safari and Firefox but not identical, so for subtle problems
it is still worth a look in the real browser. Safari itself can't be driven this way; `webkit` is the nearest.

Some things differ by browser:

- Firefox has no mobile emulation. Phone sizes, pixel density and touch still apply, but the page isn't told it's in
  a phone browser (there is no meta viewport handling).
- `moz-firefox` is driven over WebDriver BiDi, which Playwright supports experimentally. facetshot sets the color
  scheme through Firefox's own preferences, so light and dark work. If a screenshot didn't get a setting the variant
  asked for, its notes say so.
- A browser that won't start fails only its own screenshots. The rest of the run goes on, and the failure says what
  the browser reported.

See [Status and limits](status.md) for which browsers have been tested where.
