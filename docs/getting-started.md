# Getting started

This page takes you from nothing to a contact sheet of your own app, and then to an agent that checks its own UI
work. It takes about ten minutes. Words such as _target_, _variant_ and _background helper_ are explained in the
[glossary](concepts.md#glossary).

## 1. Install

facetshot runs on [Bun](https://bun.sh) 1.3 or newer. Your app can be built with anything; only facetshot itself
needs Bun.

facetshot isn't on npm yet, so install it from a clone. From the folder that holds your project:

```sh
git clone <repository URL> facetshot
(cd facetshot && bun install)
cd your-project
bun add -d ../facetshot
bunx playwright install chromium
```

The last line downloads Playwright's Chromium, the browser facetshot uses by default. If your project already uses
Playwright, facetshot uses the browsers you have. Once facetshot is on npm, `bun add -d facetshot` will replace the
first four lines.

Check that everything is in place:

```sh
bunx facetshot doctor
```

`doctor` lists what it found and, for anything missing, the command that fixes it.

## 2. Take screenshots of any page

No config is needed for a full URL:

```sh
bunx facetshot https://example.com
```

The summary looks like this:

```
8/8 screenshots · 1 screen · 4 devices × 2 variants · 4.1s (1.2s getting ready)

Sheets:
  /your/project/.facetshot/runs/20261110-091502-3f1a/example.com.sheet.jpg
```

Open the sheet. Each row is a device (a desktop, a tablet in both orientations, a phone) and each column a variant
(light and dark). The single screenshots are in a folder next to it.

Choose devices and variants with `--on` and `--as`:

```sh
bunx facetshot https://example.com --on phone --as light,dark,large
```

Add `.facetshot/` to your `.gitignore`. Runs, logs and saved sign-ins are kept there.

## 3. Point it at your app

For your own app you want short paths (`/settings`) instead of full URLs, and facetshot to build and start the app
for you. `init` writes a config from what your project already uses (Vite, SvelteKit, Next.js, Astro, Nuxt,
Storybook, Electron, Tauri or a Swift package):

```sh
bunx facetshot init
```

For a Vite app that uses Bun, you get something like this:

```ts
// facetshot.config.ts
import { defineConfig } from 'facetshot';

export default defineConfig({
	web: {
		build: {
			cmd: 'bunx --bun vite build',
			inputs: ['src', 'public', 'index.html', 'package.json']
		},
		serve: { cmd: 'bunx --bun vite preview --port {port} --strictPort', port: 'auto' },
		ready: { gone: ['[aria-busy=true]', '.spinner', '.skeleton'] }
	},
	profiles: {
		default: { on: ['review'], as: ['light', 'dark'] }
	}
});
```

The commands are your app's own: `init` writes `bunx --bun …` when it finds `bun.lock`, and `npx …` otherwise. Change
them to whatever your project uses to build and serve itself.

What each part means:

- `build` makes a production build, but only when something under `inputs` has changed since the last build. Add
  any other file the build reads, such as `vite.config.ts`.
- `serve` starts a server for that build. `{port}` is filled in with a free port. facetshot keeps the server
  running between runs and restarts it after a rebuild.
- `ready` lists what means "still loading" in your app. facetshot waits for those elements to disappear before it
  takes a screenshot.
- `profiles.default` is what you get when you don't pass `--on` or `--as`. `review` is a built-in group: desktop,
  tablet in landscape and portrait, and phone.

If `init` finds nothing it can build or start, it writes nothing and says what it looked for. In that case, run it in
your project's folder, or tell it where the app is already running (your own dev server, staging or production):

```sh
bunx facetshot init --url http://localhost:3000
```

Now take screenshots of your own pages:

```sh
bunx facetshot / /settings
```

The first run builds and starts things, so it takes longer. Run it again and it's quick, because the browser and the
server are still running.

If your app needs a signed-in user, test data or an API server, see
[Sign-in, servers and test data](auth-and-data.md).

## 4. Let your agent use it

```sh
bunx facetshot init --agent claude     # or cursor, codex, all
```

This registers facetshot's MCP server with your agent and installs a short skill that tells it when to look and how.
Then ask your agent to "check the settings page on a phone in dark mode" and it calls facetshot itself. See
[AI agents](agents.md) for what this writes and how to work with an agent.

## What next

- [How it works](concepts.md) explains targets, devices, variants and the background helper.
- [Flows](flows.md) take screenshots of menus, dialogs and half-filled forms.
- [Sessions](sessions.md) let you use a page step by step and see what each click does.
- [Comparing](comparing.md) shows only what changed since the last run.
