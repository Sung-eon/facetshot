# Getting started

This page takes you from nothing to a contact sheet of your own app, and then to an agent that checks its own UI
work. It takes about ten minutes. Words such as _target_, _variant_ and _background helper_ are explained in the
[glossary](concepts.md#glossary).

## 1. Install

facetshot runs on [Bun](https://bun.sh) 1.3 or newer. Your app can be built with anything; only facetshot itself
needs Bun.

In your project's folder:

```sh
bun add -d facetshot
bunx playwright install chromium
```

The last line downloads Playwright's Chromium (about 600 MB), the browser facetshot uses by default. facetshot uses
Playwright 1.64; if your project uses the same version, the browsers are shared, otherwise this downloads facetshot's
own copy.

facetshot is tested on macOS. Web pages should work on Linux and Windows, but nobody has tried them there yet; see
[Status and limits](status.md).

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

Report: /your/project/.facetshot/runs/20261110-091502-3f1a/report.html
Details: /your/project/.facetshot/runs/20261110-091502-3f1a/manifest.json
Logs: /your/project/.facetshot/runs/20261110-091502-3f1a/logs.txt (12 lines)
```

Open the sheet, or `report.html` for every screenshot on one page. Each row of the sheet is a device (a desktop, a
tablet in both orientations, a phone) and each column a variant (light and dark). The single screenshots are in a
folder next to it.

The first run also starts the [background helper](concepts.md#the-background-helper), which keeps the browser open
for 15 minutes so the next run is quick. `bunx facetshot daemon stop` stops it now.

Choose devices and variants with `--on` and `--as`:

```sh
bunx facetshot https://example.com --on phone --as light,dark,large
```

Runs, logs and saved sign-ins are kept in `.facetshot/`. Add this to your `.gitignore`:

```
.facetshot/*
!.facetshot/baselines/
```

The second line lets you commit saved [baselines](comparing.md) later; without it, git can't include anything under
`.facetshot/`.

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

SvelteKit: `vite preview` needs an adapter it can serve, such as `adapter-node`; see
[SvelteKit](auth-and-data.md#sveltekit).

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
Restart your agent: it loads MCP servers when it starts, and Claude Code asks you to approve the `facetshot` server
the first time. Then ask it "which facetshot tools do you have?", and after that something like "check the settings
page on a phone in dark mode". See [AI agents](agents.md) for what this writes and how to work with an agent.

## Updating and removing

To update, run `bun update facetshot`. A newer facetshot may use a newer Playwright; if `facetshot doctor` says a
browser is missing, run `bunx playwright install chromium` again.

To work on facetshot itself, clone https://github.com/Sung-eon/Facetshot and see the Contributing section of its
README.

To remove facetshot from a project:

1. `bunx facetshot clean --all` stops the background helper and removes what facetshot made.
2. `bun remove facetshot`, and delete `.facetshot/` and `facetshot.config.ts`.
3. Remove the `facetshot` entry from `.mcp.json`, `.cursor/mcp.json` or `.codex/config.toml`, and delete
   `.claude/skills/facetshot/`, `.agents/skills/facetshot/` or `.cursor/rules/facetshot.mdc`, whichever `init` wrote.
4. If no other project uses it, delete `~/.facetshot/`. Playwright's browsers are in `~/Library/Caches/ms-playwright`
   (macOS) or `~/.cache/ms-playwright` (Linux), shared with any other Playwright project.

## What next

- [How it works](concepts.md) explains targets, devices, variants and the background helper.
- [Flows](flows.md) take screenshots of menus, dialogs and half-filled forms.
- [Sessions](sessions.md) let you use a screen step by step and see what each click does.
- [Comparing](comparing.md) shows only what changed since the last run.
- [Troubleshooting](troubleshooting.md) helps when a screenshot shows a spinner or the sign-in page.
