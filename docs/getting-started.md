# Getting started

This page takes you from nothing to a contact sheet of your own app, and then to an agent that checks its own UI
work. It takes about ten minutes.

## 1. Install

facetshot runs on [Bun](https://bun.sh) 1.3 or newer. (Your app can be built with anything; only facetshot itself
needs Bun. Running on Node will come with the npm release.) Add it to your project and install the browser it
drives:

```sh
bun add -d facetshot
bunx playwright install chromium
```

facetshot isn't on npm yet. Until it is, clone this repository, run `bun install` in it, and add it from there:
`bun add -d /path/to/facetshot`.

If your project already uses Playwright, facetshot uses the browsers you have.

Check that everything it needs is in place:

```sh
bunx facetshot doctor
```

`doctor` lists what it found and, for anything missing, the one command that fixes it.

## 2. Take a picture of any page

No config is needed for a full URL:

```sh
bunx facetshot https://example.com
```

You'll see a summary like this:

```
8/8 pictures · 1 screen · 4 devices × 2 variants · 4.1s (1.2s getting ready)

Sheets:
  /your/project/.facetshot/runs/20261110-091502-3f1a/example.com.sheet.jpg
```

Open the sheet. Each row is a device (a desktop, a tablet both ways up, a phone), each column a variant (light and
dark). The individual pictures sit next to it in a folder per screen, and `manifest.json` describes everything that
happened.

Pick devices and variants yourself with `--on` and `--as`:

```sh
bunx facetshot https://example.com --on phone --as light,dark,large
```

Add `.facetshot/` to your `.gitignore` — that's where pictures and logs live.

## 3. Point it at your app

For your own app you want short paths (`/settings`) instead of full URLs, and facetshot starting the app for you. Let
it write a config from what your project already uses:

```sh
bunx facetshot init
```

For a Vite app, you get something like this:

```ts
// facetshot.config.ts
import { defineConfig } from 'facetshot';

export default defineConfig({
	web: {
		build: { cmd: 'npx vite build', inputs: ['src', 'public', 'index.html', 'package.json'] },
		serve: { cmd: 'npx vite preview --port {port} --strictPort', port: 'auto' },
		ready: { gone: ['[aria-busy=true]', '.spinner', '.skeleton'] }
	},
	profiles: {
		default: { on: ['review'], as: ['light', 'dark'] }
	}
});
```

If `init` finds nothing it can build or start — the folder isn't a project, or it's a kind of app `init` doesn't
recognise — it writes nothing and tells you so, instead of a config that would only fail later. Then either run it in
your project's folder, or tell it where an app is already running (yours, staging or production):

```sh
bunx facetshot init --url http://localhost:3000
```

What the Vite config above means:

- **`build`** makes a production build, and only when one of the `inputs` has changed since the last build. Pictures
  of a production build are faster to take and closer to what your users see than pictures of a dev server.
- **`serve`** starts a server for that build. `{port}` is filled in with a free port. facetshot keeps the server
  running between runs and restarts it after a rebuild.
- **`ready`** lists things that mean "still loading" in your app. facetshot waits for them to disappear before it
  takes a picture.
- **`profiles.default`** is what you get when you don't pass `--on` or `--as`. `review` is a built-in group: desktop,
  tablet landscape, tablet portrait and phone.

Now take pictures of your own pages:

```sh
bunx facetshot / /settings
```

The first run builds and starts things, so it takes longer. Run it again and it's quick: the browser and the server
are still up.

If your app needs a signed-in user, test data or an API server, see [Web apps](web.md).

## 4. Let your agent use it

```sh
bunx facetshot init --agent claude     # or cursor, codex, all
```

This registers facetshot's MCP server with your agent and adds a short skill that tells it when to look and how.
From then on, ask your agent to "check the settings page on a phone in dark mode" and it will call facetshot itself.
See [AI agents](agents.md) for what the tools do and how to get the most out of them.

## What next

- [How it works](concepts.md) explains targets, devices, variants and the background helper.
- [Flows](flows.md) get you pictures of menus, dialogs and forms halfway through.
- [Comparing](comparing.md) shows only what changed since the last run.
