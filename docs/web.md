# Web apps

Everything about taking pictures of a web app: where facetshot finds it, how it signs in, the test data it uses, and
how it decides a page is ready.

## Where your app is

There are two ways to tell facetshot where your app runs.

**You run it, facetshot visits it.** Set `baseURL` and paths like `/settings` go there:

```ts
web: {
	baseURL: 'http://localhost:3000';
}
```

**facetshot builds and starts it.** Give it a build and a server:

```ts
web: {
	build: {
		cmd: 'npx vite build',
		inputs: ['src', 'public', 'index.html', 'vite.config.ts', 'package.json'],
		output: 'dist'
	},
	serve: { cmd: 'npx vite preview --port {port} --strictPort', port: 'auto' }
}
```

- The build runs only when something under `inputs` changed (facetshot hashes their contents; in a git checkout it
  reads git's index, so this is fast even for big projects). If `output` is missing, it builds again.
- The server starts once and stays up between runs. After a rebuild it restarts, so you never look at stale code.
- `port: 'auto'` picks a free port. Use a fixed number when something else needs to know it — for example an API
  that only accepts requests from a known origin.

### A site that's already live

A staging or production site is just another address. For a quick look, give full URLs and no config at all:

```sh
facetshot https://app.example.com/pricing https://app.example.com/docs --on phone,desktop
```

To use your config's personas, variants and checks against it, let an environment variable choose where `baseURL`
points. `baseURL` wins over `build` and `serve`, so nothing is built or started for the web app:

```ts
const live = process.env.SITE; // e.g. SITE=https://staging.example.com

export default defineConfig({
	web: { baseURL: live, build: { … }, serve: { … } },
	services: live ? {} : { api: { … } },
	fixtures: live ? undefined : { setup: './facetshot/seed.ts' }
});
```

A few things are different on a live site:

- **Sign in for real.** A sign-in that only exists in development isn't there. Use a persona with a login
  [flow](flows.md) or a saved `storageState` file, for a test account rather than a real person's.
- **Test data is real data.** Whatever `fixtures.setup` creates lands in the live database, which is why the example
  leaves fixtures (and local services) out when `SITE` is set. Point at pages that already exist instead.
- **Be gentle with it.** Every picture is a page load from a real user's point of view, with rate limits,
  analytics and alerting attached. Narrow the run with `--on`, `--as` and a short list of screens.

To see how your local build differs from what users have now, take the live pictures as a baseline and compare
([Comparing](comparing.md)):

```sh
SITE=https://app.example.com facetshot /pricing /docs
facetshot baseline save live
facetshot /pricing /docs --diff live
```

### Why a build and not your dev server

Dev servers compile each page the first time it's opened and re-bundle after every edit, which makes the first
pictures slow and sometimes catches a page halfway through a reload. A production build is compiled once, loads fast,
and looks exactly like what users get. If your app has no production build you can run locally, a dev server works
too — just put its command in `serve`.

### Sign-in that only exists in development

Many apps sign in a fake local user only in development mode, so a production build can't sign in locally. A common
fix is a separate build mode just for screenshots, which keeps the local sign-in and can't be deployed:

```ts
build: { cmd: 'vite build --mode screenshots', inputs: [...] },
serve: { cmd: 'vite preview --mode screenshots --port {port}' }
```

In your app, enable the local sign-in when `import.meta.env.DEV || import.meta.env.MODE === 'screenshots'`, write that
condition inline where it's used (bundlers only drop dead code reliably when the constant is right there), and
build that mode without a deployment adapter so the output can't be shipped by accident. Add a test that a normal
production build doesn't contain the local user.

## Servers your app needs

An API, a mock server or anything else goes under `services`. Each starts before the pictures and is shared by every
run while the daemon is up:

```ts
services: {
	api: {
		cmd: 'npm run api',
		cwd: '../api',
		port: 4000,
		health: '/health',
		env: { CORS_ORIGIN: 'http://localhost:5390' },
		reuse: 'http://localhost:4000'
	}
}
```

- `health` is a path (or full URL) that answers 2xx once the service is ready. facetshot waits up to `startTimeout`
  (2 minutes by default).
- `reuse`: if this URL already answers, facetshot uses it and starts nothing.
- If the port is taken by something that doesn't answer `health`, the run stops and tells you how to find the process.
- The URL of each service is available as `{services.api.url}` in other commands and environment variables.

## Who is signed in

A **persona** is a signed-in person. Define them under `web.personas` and use one through a variant:

```ts
web: {
	personas: {
		admin: { cookies: [{ name: 'session', value: 'dev-admin' }] },
		viewer: { headers: { 'X-Dev-User': 'viewer' } },
		customer: { login: 'flows/login.yaml', ttl: 720 },
		saved: { storageState: '.auth/customer.json' }
	},
	persona: 'admin'
},
variants: {
	'as-viewer': { persona: 'viewer' }
}
```

```sh
facetshot /billing --as light,as-viewer
```

A persona can set cookies, request headers or `localStorage` entries, load a Playwright storage state file, or run a
[flow](flows.md) that signs in (its result is cached for `ttl` minutes). `web.persona` is who is signed in when a
variant doesn't say.

## Test data

Pages that show a specific record need one to exist. `fixtures.setup` makes test data before the first picture and
returns ids for `{placeholders}` in targets; `fixtures.remove` deletes each thing it made:

```ts
fixtures: {
	async setup(ctx) {
		const project = await api.post('/projects', { name: ctx.label });
		ctx.record('project', project.id);
		return { project: project.id };
	},
	async remove(item) {
		if (item.kind === 'project') await api.delete(`/projects/${item.id}`);
	}
},
aliases: { project: '/projects/{project}' }
```

```sh
facetshot project /projects
```

- `ctx.label` is `facetshot-<run id>`. Put it on what you make, so it's easy to spot.
- `ctx.record(kind, id)` writes the item to a ledger before you return. If the run is killed, the next run removes
  everything the ledger lists.
- While the daemon is up, test data is made once and reused by later runs, and removed when the daemon stops. Set
  `reuse: false` for fresh data every run, removed when that run ends.

## When a page counts as ready

facetshot takes a picture when all of these are true, checked every 50 ms:

1. The page has loaded and its fonts have finished loading.
2. No request has been in flight for `idle` milliseconds (300 by default). WebSockets, event streams and anything open
   for more than 10 seconds (long polling) don't count.
3. Nothing in `gone` is visible, and everything in `visible` is.
4. The `when` expression, if any, is true.

Then it waits for two painted frames and takes the picture with animations stopped and the text cursor hidden.

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

Rules under `routes` apply to paths matching the pattern (`*` within a segment, `**` across) and add to the general
ones. Set `idle: 0` for pages that never stop talking to the server (editors that autosave, live dashboards).

If a page isn't ready after `timeout` (15 s), facetshot takes the picture anyway and tells you what it was still
waiting for:

```
Taken before the screen settled (2):
  editor: Not settled after 15s: still waiting for the network (PUT /docs/42/autosave).
```

## Keeping pictures the same from run to run

Pictures should only change when your UI does. facetshot already turns off animations, blocks service workers and
emulates `prefers-reduced-motion`. A few settings help with the rest:

```ts
web: {
	clock: '2026-01-15T10:30:00Z',     // "3 minutes ago" stays "3 minutes ago"
	mask: ['.avatar', 'time'],         // painted over in every picture
	storage: { 'intro-seen': '1' },    // first-run dialogs, cookie banners
	block: ['**/analytics/**'],        // requests to stop
	rewrite: [{ from: 'https://cdn.example.com', to: 'http://localhost:4001' }],
	css: '.chat-widget { display: none !important }'
}
```

## Large text and other variants on the web

Browsers have no "larger text" setting to emulate, so `large`, `xlarge` and `xxl` set the root font size to 125%,
150% and 200%. That's what a person who raises their browser's default font size gets, and it's what `rem`-based
layouts respond to. If your app scales text differently, change it:

```ts
web: { textSizes: { large: '112.5%', xxl: '175%' } }
```

The other variants map to the browser's own emulation: `dark` to `prefers-color-scheme`, `contrast` to
`prefers-contrast: more`, `forced` to forced colors, `rtl` to `dir="rtl"` on the page, `offline` to no network,
`print` to print media, and `locale`/`timezone` to the browser's language and time zone.

## Choosing a browser

Chromium is the default. Set `web.browser` to `webkit` (Safari's engine) or `firefox` to use another, after
`npx playwright install webkit`.
