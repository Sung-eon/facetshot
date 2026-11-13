# Sign-in, servers and test data

To log in to your app before each screenshot, start the servers it talks to, or make records for it to show, add
these parts to `facetshot.config.ts`:

| Part                    | What it does                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------- |
| [Personas](#personas)   | sign in as a user, with cookies, headers, storage or a login flow                     |
| [Services](#services)   | start your API, a mock server or anything else your app talks to                      |
| [Test data](#test-data) | make the records a page needs before the first screenshot, and remove them afterwards |

The page ends with [a complete example](#a-complete-example-web-app-and-api) of a web app with its own API. How
facetshot builds and serves the web app itself is in [Web apps](web.md).

## Personas

A **persona** is a signed-in user. Define personas under `web.personas`, choose the usual one with `web.persona`, and
choose another for some screenshots with a variant:

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

The fields are listed in the [configuration reference](configuration.md#webpersonas). A few things to know:

- `cookies` go to the app's own host name unless you give a `domain`, so an API on another host doesn't get them.
  They need a known app address (`web.baseURL` or `web.serve`).
- `headers` are sent with every request the page makes, including requests to other sites.
- `login` is a [flow](flows.md) that signs in. It runs once in a fresh browser context, and the signed-in state is
  saved to `.facetshot/auth/<persona>.json` and reused until it is older than `ttl` minutes. If the flow fails, the
  run says that signing in failed and which step stopped. Its steps hold any password as written, so use a test
  account, and keep the flow out of git if the password matters.
- If a persona has both `storageState` and `login`, the file is used.
- Personas apply to web pages and Storybook. Electron windows don't get them yet ([Desktop
  apps](desktop.md#electron)).

### Saving a storage state file

To sign in once by hand and save the result, use Playwright's code generator. It opens a browser; sign in, then
close it:

```sh
bunx playwright codegen --save-storage=.auth/user.json https://staging.example.com/login
```

Then use `storageState: '.auth/user.json'` in a persona. The file holds a live session, so add `.auth/` to your
`.gitignore`. Use a test account, never a real person's.

## Sign-in that only exists in development

Many apps sign in a fake local user only in development mode, so a production build can't sign in locally. One way
around this is a separate build mode for screenshots, which keeps the local sign-in and can't be deployed:

```ts
build: { cmd: 'vite build --mode screenshots', inputs: ['src', 'index.html', 'vite.config.ts', 'package.json'] },
serve: { cmd: 'vite preview --mode screenshots --port {port} --strictPort', port: 'auto' }
```

In your app, enable the local sign-in when `import.meta.env.DEV || import.meta.env.MODE === 'screenshots'`. Write that
condition inline where it is used, since bundlers remove unused code reliably only when the constant is right there.
Build that mode without a deployment adapter, so the output can't be shipped by accident, and add a test that a
normal production build doesn't contain the local user.

### SvelteKit

For a SvelteKit app, list everything the build reads as inputs, and pass the API's address through an environment
variable the app reads with `$env/static/public` or `import.meta.env`:

```ts
web: {
	build: {
		cmd: 'bunx --bun vite build --mode screenshots',
		inputs: ['src', 'static', 'svelte.config.js', 'vite.config.ts', 'package.json'],
		env: { PUBLIC_API_URL: '{services.api.url}' }
	},
	serve: { cmd: 'bunx --bun vite preview --mode screenshots --port {port} --strictPort', port: 'auto' }
}
```

For the screenshots build, use an adapter that `vite preview` can serve (such as `@sveltejs/adapter-node`), not the
one you deploy with.

## Services

An API, a mock server or anything else your app talks to goes under `services`. Each service starts before the first
screenshot and stays up for later runs while the [background helper](concepts.md#the-background-helper) is running:

```ts
services: {
	api: {
		cmd: 'bun run api',
		cwd: '../api',
		port: 4000,
		health: '/health',
		reuse: 'http://localhost:4000'
	}
}
```

- `port` is a number, or `auto` for a free one. Leaving it out means `auto`.
- `health` is a path (or full URL) that answers once the service is ready. facetshot waits up to `startTimeout`
  milliseconds for it. What counts as an answer, and the defaults, are in the
  [configuration reference](configuration.md#services).
- `reuse`: if this URL already answers, facetshot uses it and starts nothing. The URL itself is asked, not `health`,
  so give one that answers only when the service is up (for example `http://localhost:4000/health`).
- If the port is taken by something that doesn't answer `health`, the run stops and the message shows how to find
  that process.
- Services start one after another, in the order you list them, so a later service can use an earlier one's
  `{services.<name>.url}`.

A service doesn't get the environment of the terminal or agent that asked for the run
([why](configuration.md#settings-that-differ-per-checkout-or-per-person)). To pass one of your variables to it, read
it in the config and put it in `env`:

<!-- prettier-ignore -->
```ts
services: {
	api: { cmd: 'bun run api', env: { DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://localhost/app_dev' } }
}
```

## Placeholders

Commands, environment values and targets can contain placeholders, which facetshot fills in once the value is known.
Each one is available only from the moment it exists:

| Placeholder                     | Is                                                                | Can be used in                                                    |
| ------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| `{port}`, `{url}`               | the port of this service or server, and `http://localhost:{port}` | that service's or server's own `cmd` and `env`                    |
| `{services.<name>.url}`         | a service's address                                               | later services, builds, the web app's `serve`, app `env`, targets |
| a name `fixtures.setup` returns | e.g. `{project}`                                                  | builds, servers, app `env`, targets                               |
| `{web.url}`                     | where the web app is served                                       | targets and flow addresses only                                   |

`{web.url}` is set only after the web app's server is up, which is after services and test data have been made. It
can't be used in a service's `env` (to tell an API which origin to accept, say). Give the web app a fixed port
instead, as in the [complete example](#a-complete-example-web-app-and-api).

## Test data

Pages that show a specific record need one to exist. `fixtures.setup` is a function that makes test data before the
first screenshot and returns string values for `{placeholders}` in targets. `fixtures.remove` deletes one thing it
made:

```ts
fixtures: {
	async setup(ctx) {
		const response = await fetch(`${ctx.services.api.url}/projects`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: ctx.label })
		});
		const project = (await response.json()) as { id: number };
		ctx.record('project', String(project.id));
		return { project: String(project.id) };
	},
	async remove(item, ctx) {
		if (item.kind === 'project')
			await fetch(`${ctx.services.api.url}/projects/${item.id}`, { method: 'DELETE' });
	}
},
aliases: { project: '/projects/{project}' }
```

```sh
facetshot project /projects
```

`setup` receives a context with these fields:

| Field                          | What it is                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.runId`                    | the run's id                                                                                                                           |
| `ctx.label`                    | `facetshot-<run id>`. Put it on what you make, so it is easy to find                                                                   |
| `ctx.services`                 | each service's address: `ctx.services.api.url`                                                                                         |
| `ctx.record(kind, id, extra?)` | writes the item to a ledger in `.facetshot/` before you return. If the run is killed, the next run removes everything the ledger lists |
| `ctx.log(message)`             | a line in the run's output                                                                                                             |

`remove` receives `{ kind, id, extra }` as recorded, and the same context.

While the background helper is running, test data is made once, reused by later runs, and removed when the helper
stops. Set `reuse: false` to make fresh data for every run and remove it when that run ends.

A larger `setup` is easier to keep in its own file. Import it in the config, since `setup` must be a function:

```ts
import { defineConfig } from 'facetshot';
import { removeTestData, makeTestData } from './facetshot/test-data.ts';

export default defineConfig({
	fixtures: { setup: makeTestData, remove: removeTestData }
});
```

## A complete example: web app and API

A Vite app whose API checks the request's origin. The API must know the web app's address before either starts, so
both get fixed ports from `stablePorts`, which also keeps several checkouts of the project from using the same ports
([Settings that differ per checkout](configuration.md#settings-that-differ-per-checkout-or-per-person)):

```ts
import { defineConfig, stablePorts } from 'facetshot';

const [webPort, apiPort] = stablePorts(import.meta.dirname, 2);

export default defineConfig({
	services: {
		api: {
			cmd: 'bun run dev',
			cwd: '../api',
			port: apiPort,
			health: '/health',
			env: {
				PORT: '{port}',
				CORS_ORIGIN: `http://localhost:${webPort}`,
				DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://localhost/app_screenshots'
			}
		}
	},
	web: {
		build: {
			cmd: 'bunx --bun vite build',
			inputs: ['src', 'public', 'index.html', 'vite.config.ts', 'package.json'],
			env: { VITE_API_URL: '{services.api.url}' }
		},
		serve: { cmd: 'bunx --bun vite preview --port {port} --strictPort', port: webPort },
		personas: { member: { cookies: [{ name: 'dev-user', value: 'member' }] } },
		persona: 'member'
	},
	fixtures: {
		async setup(ctx) {
			const response = await fetch(`${ctx.services.api.url}/projects`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: ctx.label })
			});
			const { id } = (await response.json()) as { id: number };
			ctx.record('project', String(id));
			return { project: String(id) };
		},
		async remove(item, ctx) {
			await fetch(`${ctx.services.api.url}/projects/${item.id}`, { method: 'DELETE' });
		}
	},
	aliases: { project: '/projects/{project}' }
});
```

In order, a run starts the API on `apiPort` and waits for `/health`, makes a project, builds the web app with the
API's address in `VITE_API_URL` (only when an input changed), serves it on `webPort`, and takes screenshots signed in
as `member`.
