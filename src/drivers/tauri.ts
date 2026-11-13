/**
 * Tauri apps. A Tauri window is the system's web view (WKWebView on macOS, WebView2 on Windows, WebKitGTK on
 * Linux), and on macOS that web view can't be driven from outside, so there are two ways to screenshot one:
 *
 * - `webkit` (the default when `desktop.frontend` is set): the app's web frontend, served as it is in the app, opened
 *   in Playwright's WebKit at the window's size — the same engine family as WKWebView, with everything the web gets
 *   (variants, readiness, checks, flows, masks). There is no Rust backend in a browser, so `invoke()` is answered
 *   from `desktop.invoke` and anything else rejects with an error naming the command. Playwright's WebKit is a recent
 *   WebKit build, not the exact one in the user's macOS: system-specific differences (a Safari-only bug in an older
 *   macOS) won't show.
 * - `window`: the built `.app`, launched for real, sent to each screen by deep link (`open <scheme>://<path>`; the
 *   app registers the scheme with Tauri's deep-link plugin), and its window captured with the Mac's window capture
 *   (`captureMacWindow` in `./macos.ts`). Dark is the system's own `-AppleInterfaceStyle Dark` launch argument, which
 *   AppKit and the web view follow; what the system can't switch from outside is passed to the app as
 *   environment variables (`FACETSHOT_APPEARANCE`, `FACETSHOT_TEXT`, `FACETSHOT_LOCALE`, `FACETSHOT_WIDTH`,
 *   `FACETSHOT_HEIGHT`) for it to honour, e.g. with `window.setTheme()` and `window.setSize()` in its setup hook.
 *
 * Other systems (not built yet, so they say so instead of guessing):
 * - Windows: WebView2 speaks the Chrome DevTools Protocol. Start the app with
 *   `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>` and attach with Playwright's
 *   `chromium.connectOverCDP`; the window's page then works like Electron's (resize through the app, media emulation).
 * - Linux: WebKitGTK is driven over WebDriver by `tauri-driver` (cargo install tauri-driver), which wraps
 *   `WebKitWebDriver`; screenshots come from WebDriver's screenshot command, checks from scripts run through it.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Cell, CellResult, Config, DesktopConfig, Device, Variant } from '../types.ts';
import { ensureBuilt } from '../engine/build.ts';
import { exec, healthy, sleep, spawnGroup, stopGroup, waitUntil } from '../engine/procs.ts';
import { EnvironmentError, firstLine, UsageError } from '../errors.ts';
import { fill } from '../plan.ts';
import { bundleExecutable } from './apple.ts';
import {
	byDeviceAndVariant,
	failed,
	groupBy,
	reporter,
	result,
	notApplied,
	type Driver,
	type RunContext
} from './driver.ts';
import { captureMacWindow } from './macos.ts';
import { imagePath } from './page.ts';
import {
	builtServer,
	newSession,
	navigate,
	shootCell,
	shootInContexts,
	type ShootOptions
} from './web.ts';

/** Which way `app:` targets are shot for this config. */
export function tauriEngine(desktop: DesktopConfig): 'webkit' | 'window' {
	if (desktop.engine) return desktop.engine;
	return desktop.frontend ? 'webkit' : 'window';
}

/**
 * Stands in for Tauri's IPC in a plain browser: `window.__TAURI_INTERNALS__` is what `@tauri-apps/api` calls. Event
 * listeners register and never fire; `invoke` answers from `answers` or rejects.
 */
export function tauriMockScript(answers: Record<string, unknown> = {}): string {
	return `(() => {
		const answers = ${JSON.stringify(answers)};
		let next = 1;
		window.__TAURI_INTERNALS__ = {
			invoke: async (cmd, args) => {
				if (Object.prototype.hasOwnProperty.call(answers, cmd)) return answers[cmd];
				if (cmd.startsWith('plugin:event|')) return next++;
				throw new Error('facetshot: there is no Tauri backend in the browser, so invoke("' + cmd + '") has no answer. Add it to desktop.invoke in facetshot.config.ts.');
			},
			transformCallback: (callback, once) => {
				const id = next++;
				window['_' + id] = (result) => { if (once) delete window['_' + id]; return callback && callback(result); };
				return id;
			},
			unregisterCallback: (id) => { delete window['_' + id]; },
			convertFileSrc: (path, protocol = 'asset') => protocol + '://localhost/' + encodeURIComponent(path),
			metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
			plugins: {}
		};
		window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
		window.isTauri = true;
	})();`;
}

/** The deep link for a path: `myapp` + `/settings` → `myapp://settings`. */
export function deepLink(scheme: string, path: string): string {
	if (/^[a-z][\w+.-]*:/i.test(path)) return path;
	return `${scheme.replace(/:\/*$/, '')}://${path.replace(/^\/+/, '')}`;
}

/** The environment that tells a Tauri app which variant and size to show (window engine). */
export function variantEnv(device: Device, variant: Variant): Record<string, string> {
	return {
		FACETSHOT: '1',
		FACETSHOT_WIDTH: String(device.width),
		FACETSHOT_HEIGHT: String(device.height),
		FACETSHOT_APPEARANCE: variant.appearance ?? 'light',
		...(variant.text && variant.text !== 'default' ? { FACETSHOT_TEXT: variant.text } : {}),
		...(variant.locale
			? { FACETSHOT_LOCALE: variant.locale, LANG: `${variant.locale.replace('-', '_')}.UTF-8` }
			: {}),
		...(variant.timezone ? { TZ: variant.timezone } : {}),
		...(variant.motion === 'reduce' ? { FACETSHOT_REDUCE_MOTION: '1' } : {})
	};
}

export class TauriDriver implements Driver {
	readonly name = 'tauri';
	private baseURL = '';

	/** Where the frontend is served, once `prepare` has started it (WebKit engine). */
	get frontendURL(): string {
		return this.baseURL;
	}
	private app = '';

	handles(cell: Cell, config: Config): boolean {
		return (
			config.desktop?.kind === 'tauri' &&
			cell.device.platform === 'window' &&
			(cell.target.kind === 'app' || cell.target.kind === 'flow')
		);
	}

	async prepare(cells: Cell[], ctx: RunContext): Promise<void> {
		const desktop = ctx.config.desktop!;
		if (tauriEngine(desktop) === 'webkit') return this.prepareFrontend(ctx, desktop);
		if (process.platform === 'win32') {
			throw new EnvironmentError(
				"Tauri's real window isn't supported on Windows yet.",
				'Shoot the frontend instead (desktop.frontend). Planned: attach to WebView2 over CDP with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>.'
			);
		}
		if (process.platform !== 'darwin') {
			throw new EnvironmentError(
				`Tauri's real window isn't supported on ${process.platform} yet.`,
				'Shoot the frontend instead (desktop.frontend). Planned: drive WebKitGTK through tauri-driver (WebDriver).'
			);
		}
		if (cells.some((cell) => cell.target.kind === 'flow')) {
			throw new UsageError(
				"Flows need a page to click in, which Tauri's real window doesn't give.",
				'Use desktop.engine: "webkit" with desktop.frontend for flows.'
			);
		}
		if (!desktop.navigate && cells.some((cell) => cell.target.value !== '/')) {
			throw new UsageError(
				'app: paths in a Tauri window are reached by deep link, and desktop.navigate names no scheme.',
				'Register a scheme with the deep-link plugin (tauri-plugin-deep-link) and set desktop.navigate to it, e.g. "myapp".'
			);
		}
		if (desktop.build)
			await ensureBuilt(
				'tauri',
				{ heavy: true, ...desktop.build },
				{ ...ctx, heavyLock: ctx.locks.build }
			);
		const app = desktop.app ? resolve(ctx.root, fill(desktop.app, ctx.values)) : undefined;
		if (!app || !existsSync(app)) {
			throw new UsageError(
				app
					? `desktop.app points at ${app}, which doesn't exist.`
					: "Tauri's window engine needs the built app.",
				'Set desktop.app to the .app (src-tauri/target/release/bundle/macos/<Name>.app) and desktop.build to the command that makes it (tauri build --bundles app).'
			);
		}
		this.app = app;
	}

	private async prepareFrontend(ctx: RunContext, desktop: DesktopConfig): Promise<void> {
		const frontend = desktop.frontend;
		if (!frontend) {
			throw new UsageError(
				'desktop.engine is "webkit", but there\'s no desktop.frontend to open.',
				'Set desktop.frontend.url (a running dev server) or desktop.frontend.cmd (e.g. "vite preview --port {port} --strictPort").'
			);
		}
		// WebKit starts while the frontend builds and its server comes up.
		const browser = ctx.runtime.browser('webkit');
		browser.catch(() => {});
		const url = frontend.url ? fill(frontend.url, ctx.values).replace(/\/$/, '') : undefined;
		if (url && (await healthy(url))) {
			this.baseURL = url;
		} else if (frontend.cmd) {
			const serve = { ...frontend, cmd: frontend.cmd };
			this.baseURL = (await builtServer(ctx, 'tauri-frontend', frontend.build, serve)).url;
		} else {
			throw new EnvironmentError(
				`The Tauri frontend isn't answering at ${url}.`,
				'Start it (e.g. npm run dev), or give desktop.frontend.cmd so facetshot starts it.'
			);
		}
		ctx.values['frontend.url'] = this.baseURL;
		await browser;
	}

	async shoot(cells: Cell[], ctx: RunContext, report: (result: CellResult) => void): Promise<void> {
		const desktop = ctx.config.desktop!;
		if (tauriEngine(desktop) === 'window') return this.shootWindows(cells, ctx, report);
		const browser = await ctx.runtime.browser('webkit');
		const web = ctx.config.web;
		const options: ShootOptions = {
			ctx,
			web,
			open: (session, address) =>
				navigate(
					session.page,
					/^https?:/.test(address)
						? address
						: this.baseURL + (address.startsWith('/') ? address : `/${address}`)
				)
		};
		const note = (result: CellResult) =>
			report({
				...result,
				notes: [
					...(result.notes ?? []),
					"Tauri frontend in Playwright's WebKit, not the app's own window."
				]
			});
		await shootInContexts(
			cells,
			ctx,
			// A window is not a phone: whatever the device says, no mobile emulation or touch.
			(device, variant) =>
				newSession(browser, { ...device, mobile: false, touch: false }, variant, web, {
					baseURL: this.baseURL,
					root: ctx.root,
					initScript: tauriMockScript(desktop.invoke)
				}),
			(session, cell) => shootCell(session, cell, options, note),
			note
		);
	}

	/** The real app, one launch per device × variant (size and theme are read at start-up), one screen at a time. */
	private async shootWindows(
		cells: Cell[],
		ctx: RunContext,
		report: (result: CellResult) => void
	): Promise<void> {
		const desktop = ctx.config.desktop!;
		const executable = bundleExecutable(this.app);
		const readyFile = join(ctx.stateDir, 'tauri-ready', `${process.pid}.ready`);
		mkdirSync(dirname(readyFile), { recursive: true });
		for (const group of groupBy(cells, byDeviceAndVariant)) {
			const { device, variant } = group[0];
			const env: Record<string, string> = {
				...(process.env as Record<string, string>),
				...variantEnv(device, variant)
			};
			for (const [key, value] of Object.entries(desktop.env ?? {}))
				env[key] = fill(value, ctx.values);
			if (desktop.readyFile) env.FACETSHOT_READY_FILE = readyFile;
			const ready = (timeout: number) => waitUntil(() => existsSync(readyFile), timeout);
			const tell = reporter(report);
			let pid: number | undefined;
			try {
				// `-AppleInterfaceStyle Dark` sets the app's defaults for this launch only: AppKit, and so the WKWebView's
				// prefers-color-scheme, follow it without the app doing anything.
				const appearance = variant.appearance === 'dark' ? ['-AppleInterfaceStyle', 'Dark'] : [];
				pid = spawnGroup(executable, [...(desktop.args ?? []), ...appearance], { env }).pid;
				if (!pid)
					throw new EnvironmentError(
						`${executable} didn't start.`,
						`Try it yourself: open ${JSON.stringify(this.app)}`
					);
				// The first screen is up once the app writes its ready file; without one, give it a moment to open its window.
				if (desktop.readyFile) await ready(30_000);
				else await sleep(2000);
				for (const cell of group) {
					const started = Date.now();
					try {
						rmSync(readyFile, { force: true });
						if (cell.target.value !== '/' || desktop.navigate)
							await exec('open', [deepLink(desktop.navigate ?? '', cell.target.value)]);
						// Without a ready file the app can't say it has settled; give it a moment to route and paint.
						const settled = desktop.readyFile ? await ready(15_000) : (await sleep(1500), true);
						const out = result(cell, {
							ms: Date.now() - started,
							readyTimedOut: settled ? undefined : true,
							notes: [
								"The app's real window: no page checks (they need the web engine).",
								...notApplied(
									variant,
									['appearance', 'text', 'locale', 'timezone', 'motion'],
									"in the app's window"
								)
							]
						});
						if (ctx.images) {
							const { file, rel } = imagePath(ctx.runDir, cell.screen, device.name, variant.name);
							const size = await captureMacWindow(pid, file);
							Object.assign(out, { image: rel, ...size, ms: Date.now() - started });
						}
						tell.report(cell, out);
					} catch (error) {
						tell.report(cell, failed(cell, firstLine(error), Date.now() - started));
					}
				}
			} catch (error) {
				tell.failRest(group, error);
			} finally {
				await stopGroup(pid);
			}
		}
	}
}
