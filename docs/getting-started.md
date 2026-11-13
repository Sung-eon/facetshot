# Getting started

This page takes you from nothing to a contact sheet of your own app, and then to an agent that checks its own UI
work. It takes about ten minutes. New words are explained in a few words where they first appear, and in full in the
[glossary](concepts.md#glossary).

## 1. Install

facetshot runs on [Bun](https://bun.sh) 1.3 or newer. Your app can be built with anything, and your project needs no
`package.json`: Flutter, Swift and other projects work the same. Only facetshot itself needs Bun.

Pick one of two ways. Install it to use it regularly: the version stays fixed until you update it, and your agent's
MCP server starts quicker. Run it without installing to try it: nothing is installed but the package Bun downloads
into its cache.

| Install it for regular use      | Try it without installing            |
| ------------------------------- | ------------------------------------ |
| `bun add -g facetshot`          |                                      |
| `facetshot setup`               | `bunx facetshot setup`               |
| `facetshot https://example.com` | `bunx facetshot https://example.com` |

`setup` downloads Playwright's Chromium (about 600 MB) and then checks this machine: it lists what it found and, for
anything missing, the command that fixes it. Run `facetshot doctor` to check again later. The rest of this page
writes `facetshot …`; without installing, type `bunx facetshot …`.

To pin the version for everyone who clones a project, add facetshot to the project instead (`bun add -d facetshot`)
and type `bunx facetshot …`; the config then gets types from `import { defineConfig } from 'facetshot'`.
[Installing, updating and removing](cli.md#installing-updating-and-removing) compares the three ways.

facetshot is tested on macOS. Web pages should work on Linux and Windows, but nobody has tried them there yet; see
[Status and limits](status.md).

## 2. Take screenshots of any page

No config is needed for a full URL:

```sh
facetshot https://example.com
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
tablet in both orientations, a phone) and each column a _variant_, a display setting such as light or dark mode. The single screenshots are in a
folder next to it.

The first run also starts the [background helper](concepts.md#the-background-helper), a process that keeps the
browser open for 15 minutes so the next run is quick. `facetshot daemon stop` stops it now.

Choose devices and variants with `--on` and `--as`:

```sh
facetshot https://example.com --on phone --as light,dark,large
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
facetshot init
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
- A _profile_ is a named choice of devices and variants. `profiles.default` is what you get when you don't pass
  `--on` or `--as`. `review` is a built-in group: desktop,
  tablet in landscape and portrait, and phone.

SvelteKit: `vite preview` needs an adapter it can serve, such as `adapter-node`; see
[SvelteKit](auth-and-data.md#sveltekit).

If `init` finds nothing it can build or start, it writes nothing and says what it looked for. In that case, run it in
your project's folder, or tell it where the app is already running (your own dev server, staging or production):

```sh
facetshot init --url http://localhost:3000
```

Now take screenshots of your own pages:

```sh
facetshot / /settings
```

The first run builds and starts things, so it takes longer. Run it again and it's quick, because the browser and the
server are still running.

If your app needs a signed-in user (a _persona_), test data or an API server, see
[Sign-in, servers and test data](auth-and-data.md).

## 4. Let your agent use it

```sh
facetshot init --agent claude     # or cursor, codex, all
```

This registers facetshot's MCP server with your agent and installs a short skill that tells it when to look and how.
Restart your agent: it loads MCP servers when it starts, and Claude Code asks you to approve the `facetshot` server
the first time. Then ask it "which facetshot tools do you have?", and after that something like "check the settings
page on a phone in dark mode". See [AI agents](agents.md) for what this writes and how to work with an agent.

## Updating and removing

To update, run `bun add -g facetshot@latest` (or `bun update facetshot` in a project), then `facetshot setup`: a newer
facetshot may use a newer Playwright, whose browser is a separate download.

To remove facetshot, run `facetshot uninstall` in your project's folder. It lists what it will remove and asks first:
the background helper, `~/.facetshot`, `.facetshot/`, what `init --agent` wrote, and the global package. It keeps
`facetshot.config.ts` and tells you what to delete by hand. See [`uninstall`](cli.md#uninstall).

If you installed the Claude Code plugin, remove it in Claude Code: type `/plugin`, open the installed plugins and
uninstall `facetshot`. `facetshot uninstall` doesn't touch plugins.

To work on facetshot itself, clone https://github.com/Sung-eon/facetshot and see its
[CONTRIBUTING.md](../CONTRIBUTING.md).

## What next

- [How it works](concepts.md) explains targets, devices, variants and the background helper.
- [Flows](flows.md), saved lists of steps such as clicks and typing, take screenshots of menus, dialogs and
  half-filled forms.
- [Sessions](sessions.md) keep one screen open, so you can use it step by step and see what each click does.
- [Comparing](comparing.md) shows only what changed since the last run.
- [Troubleshooting](troubleshooting.md) helps when a screenshot shows a spinner or the sign-in page.
