# Setup and troubleshooting

- [A project without a config](#a-project-without-a-config)
- [The config's main sections](#the-configs-main-sections)
- [Sign-in and test data](#sign-in-and-test-data)
- [doctor](#doctor)
- [Installing and fixing the install](#installing-and-fixing-the-install)
- [Common problems](#common-problems)
- [When to stop and ask](#when-to-stop-and-ask)

## A project without a config

A full URL (`https://example.com/pricing`) works with no config at all. Paths and app screens need
`facetshot.config.ts` in the project. `facetshot init` writes one: it recognises Vite, Next.js, SvelteKit, Astro,
Nuxt, Storybook, Electron, Tauri and Swift packages, and fills in the build and serve commands it found. For an app
that is already running (or deployed), `facetshot init --url http://localhost:3000` writes a config that only points
at it. When `init` finds nothing, it says what it looked for and exits with code 2.

If you're asked to set facetshot up, run `init`, look at what it wrote, then take one screenshot to prove it works
(`facetshot / --on phone --as light`). Writing a config is a change to the person's project; say what you wrote.

## The config's main sections

```ts
import { defineConfig } from 'facetshot';

export default defineConfig({
	web: {
		build: { cmd: 'bun run build', inputs: ['src', 'index.html', 'package.json'], output: 'dist' },
		serve: { cmd: 'bun run preview --port {port} --strictPort', port: 'auto' },
		// or: baseURL: 'https://staging.example.com'
		ready: { gone: ['.spinner'] },
		block: ['**/analytics/**']
	},
	services: {
		api: { cmd: 'bun run api', port: 'auto', health: '/health', env: { PORT: '{port}' } }
	},
	aliases: { settings: '/settings' },
	checks: ['console', 'network', 'overflow', 'clipped'],
	profiles: { default: { on: ['desktop', 'phone'], as: ['light', 'dark'] } }
});
```

- **`build`** runs only when its `inputs` change; `output` is what it makes. `heavy: true` makes it one at a time on
  the machine (for Xcode and other big builds).
- **`serve`** and **`services`** are servers facetshot starts and keeps running in the background helper. `port:
'auto'` picks a free port, given to the command as `{port}`; `health` is a path that answers (any status below 500) once it's ready;
  `reuse` is a URL to use instead when something there is already healthy.
- **Placeholders** in commands and targets: `{port}`, `{services.api.url}`, `{web.url}` (after the web server has
  started), and the values fixtures return.
- Other sections: `desktop` (Electron, Tauri, native Mac apps), `apple` (iOS and Mac apps by deep link),
  `storybook`, `swift`, `devices`, `groups`, `variants`, `limits`. See [platforms.md](platforms.md) for what each platform needs.

## Sign-in and test data

**Personas** are signed-in users, under `web.personas`, used by a variant (`variants: { 'as-viewer': { persona:
'viewer' } }`) or by default (`web.persona`). Each can have `cookies`, `headers` (sent on every request),
`storage` (localStorage), `storageState` (a Playwright storage-state file), or `login`: a flow file that signs in
once, after which the session is saved and reused for `ttl` minutes (default 720). A sign-in flow holds its
credentials as written, so use a test account. Personas apply to web pages, not to Electron or native apps.

**Fixtures** make test data before screenshots and remove it after:

```ts
fixtures: {
	async setup(ctx) {
		const response = await fetch(`${ctx.services.api.url}/projects`, { method: 'POST', body: JSON.stringify({ name: ctx.label }) });
		const project = await response.json();
		ctx.record('project', project.id);           // removed later, even after a crash
		return { project: project.id };              // fills {project} in targets
	},
	async remove(item, ctx) {
		await fetch(`${ctx.services.api.url}/projects/${item.id}`, { method: 'DELETE' });
	}
}
```

`ctx.label` is `facetshot-<run id>`, to mark what was made. Fixtures are kept while the background helper runs
(`reuse`, default true) and removed when it stops or with `facetshot clean`.

## doctor

`facetshot doctor` checks Bun, Playwright's browsers, the config, ports, Xcode and simulators, Electron, the Mac
permissions (Screen Recording, Accessibility) and leftover locks, and prints the fix for each problem. For a busy
port it names the process holding it (and the project, when facetshot's background helper started it). Run it first
when something about the machine is wrong. Loading the config prints a warning for each key facetshot doesn't know,
with the key it probably meant; a misspelt key is otherwise ignored.

## Installing and fixing the install

facetshot needs Bun 1.3 or newer (`bun --version`). The project needs no `package.json`. There are three ways it can
be installed; find out which before fixing anything:

| Way                    | How to tell                                                            | Run it as          |
| ---------------------- | ---------------------------------------------------------------------- | ------------------ |
| installed for the user | `which facetshot` prints a path (usually `~/.bun/bin/facetshot`)       | `facetshot …`      |
| in the project         | `node_modules/facetshot/` exists in the project (or a folder above it) | `bunx facetshot …` |
| not installed          | neither; `bunx facetshot` downloads it into Bun's cache and runs it    | `bunx facetshot …` |

`facetshot --version` (or `bunx facetshot --version`) prints the version that will run. The MCP server is whatever
command the agent's config names: `.mcp.json`, `.cursor/mcp.json` or `.codex/config.toml`, normally `bunx facetshot
mcp`, which picks the project's copy, then the user's, then downloads one.

| Problem                                                            | Do                                                                                                                                                                                      |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a browser isn't installed, or doesn't start after an update        | `facetshot setup` (`--browser webkit,firefox` for those); it installs the browsers facetshot's own Playwright needs, then runs `doctor`                                                 |
| the facetshot tools aren't there, or the MCP server won't start    | read the command in the agent's MCP config and run it with `--version` in the project's folder (`bunx facetshot --version`); if that fails, facetshot isn't installed or Bun is missing |
| `bun` isn't found, or is older than 1.3                            | the person installs or updates Bun (https://bun.sh)                                                                                                                                     |
| `The background helper is still busy running other facetshot code` | facetshot changed while it ran; your command already waited 5 minutes: try again later, or `facetshot daemon stop` when nothing else is using it                                        |
| the MCP config was missing or changed                              | `facetshot init --agent <name>` writes it; the person then restarts the agent, which reads MCP servers only when it starts                                                              |

You may run `facetshot setup`, `facetshot doctor` and `facetshot init` yourself (say what `init` wrote). Ask the
person before installing or updating facetshot (`bun add -g facetshot`, `bun add -d facetshot`), and never run
`facetshot uninstall` unless asked. Only the person can install Bun, grant Accessibility or Screen Recording, and
restart the agent.

## Common problems

| You see                                                              | Do                                                                                                                                        |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `"/x" is a path, and facetshot doesn't know which app it belongs to` | the project has no config, or no `web` section: `facetshot init`, or use a full URL                                                       |
| `Playwright's chromium isn't installed`                              | `facetshot setup` (`--browser <name>` for the browser it names)                                                                           |
| `The web build failed … The end of its log …`                        | read the log it names; it's the project's build, so fix it there or tell the person                                                       |
| a service didn't become healthy                                      | check `health`, the port, and its log in `.facetshot/logs/`                                                                               |
| `Not settled after 15s: still waiting for …`                         | fix `web.ready` ([results-checks-logs.md](results-checks-logs.md#when-a-screenshot-was-taken-too-early)); the screenshot was taken anyway |
| `none of the devices … can show a … target`                          | add a device of the right kind (`--on phone`, `--on iphone`, `--on window`)                                                               |
| `Signing in as "…" with … didn't work`                               | try the login flow's steps in a session to see where it stops                                                                             |
| `may not use Accessibility` / `may not record the screen`            | the person allows it in System Settings → Privacy & Security, for the app facetshot runs in                                               |
| `The background helper is busy with other facetshot code`            | it waits up to 5 minutes for the helper; after that a run happens in your process                                                         |
| a session id isn't found                                             | it closed after 10 idle minutes; open another (`list` with `what: "sessions"`)                                                            |
| the sign-in page or a spinner in every screenshot                    | a persona or a ready rule is missing; see above                                                                                           |

`facetshot logs latest --level warn` and `.facetshot/logs/` (build and server output) usually say why.
`facetshot clean` stops everything facetshot started for the project and removes its runs, logs, saved sign-ins
and test data.

## When to stop and ask

Stop and tell the person, quoting what facetshot said, when it needs something only they can give: a permission, an
account or password, a build that fails in their code, a config decision (which server, which port), or anything on
a live site that would change real data. Retrying the same call won't change the answer.
