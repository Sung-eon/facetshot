/**
 * Electron apps, launched through Playwright's Electron support, so their windows get everything a web page gets:
 * variants, readiness rules, checks, flows and masks (`web.*` in the config applies to them too).
 *
 * One launch per variant (and pixel density): the colour scheme, locale and density are set when the app starts or
 * through the app itself, so a fresh app is the honest way to switch them. Within a launch, devices are window
 * sizes, so the window is resized from one device to the next. Launches run one after another, never side by side:
 * many Electron apps hold a single-instance lock, and every launch is a real window on the screen.
 *
 * How each variant axis is made true:
 * - appearance: `nativeTheme.themeSource` in the main process (so the app's own `nativeTheme` listeners and native
 *   parts follow), and the page's `prefers-color-scheme` through Playwright's media emulation.
 * - motion, contrast, forced colours: Playwright's media emulation on the window's page.
 * - text size and direction: the same injected CSS and attribute the web uses (`variantScript`).
 * - locale: Chromium's `--lang` switch; time zone: the `TZ` environment variable; offline: the context goes offline.
 * - density: Chromium's `--force-device-scale-factor` switch.
 */
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import type { ElectronApplication, Page } from 'playwright';
import type { Cell, CellResult, Config, DesktopConfig, Device, Variant } from '../types.ts';
import { ensureBuilt } from '../engine/build.ts';
import { within } from '../engine/procs.ts';
import { EnvironmentError, firstLine, UsageError } from '../errors.ts';
import { fill } from '../plan.ts';
import { bundleExecutable } from './apple.ts';
import { failed, groupBy, stopped, type Driver, type RunContext } from './driver.ts';
import { mediaOptions, NetworkWatch, routeRequests, variantScript } from './page.ts';
import { navigate, shootCell, type PageSession } from './web.ts';

/** What to launch: the Electron binary and the arguments that name the app. */
export interface ElectronLaunch {
	executablePath?: string;
	args: string[];
}

/**
 * Works out what to launch from `desktop.main` and `desktop.executable`: a script or app folder runs in the
 * project's own `electron` package (or `executable`); a packaged app (`.app`, `.exe`, or any other executable file)
 * runs on its own.
 */
export function resolveLaunch(desktop: DesktopConfig, root: string): ElectronLaunch {
	const main = resolve(root, desktop.main ?? '.');
	const extra = desktop.args ?? [];
	if (main.endsWith('.app') && existsSync(main))
		return { executablePath: bundleExecutable(main), args: extra };
	if (
		existsSync(main) &&
		statSync(main).isFile() &&
		!/\.(c|m)?js$/.test(main) &&
		(/\.exe$/i.test(main) || (statSync(main).mode & 0o111) !== 0)
	) {
		return { executablePath: main, args: extra };
	}
	if (!existsSync(main)) {
		throw new UsageError(
			`desktop.main points at ${main}, which doesn't exist.`,
			"Set desktop.main to your app's main script, its folder ('.' reads package.json's main), or a packaged app."
		);
	}
	let executablePath = desktop.executable ? resolve(root, desktop.executable) : undefined;
	if (!executablePath) {
		try {
			// The `electron` package's main export is the path of the binary it downloaded.
			executablePath = createRequire(join(root, 'package.json'))('electron') as string;
		} catch {
			throw new EnvironmentError(
				`There is no Electron to run ${main} with.`,
				'Install it in the project (npm i -D electron), or set desktop.executable to an Electron binary.'
			);
		}
	}
	if (!existsSync(executablePath)) {
		throw new EnvironmentError(
			`Electron isn't at ${executablePath}.`,
			'Its download may have been skipped: reinstall it (npm rebuild electron, or bun pm trust electron) or set desktop.executable.'
		);
	}
	return { executablePath, args: [main, ...extra] };
}

/** The Chromium switches a variant and a pixel density need. They go before the app's own arguments. */
export function launchSwitches(variant: Variant, scale: number): string[] {
	const switches = [`--force-device-scale-factor=${scale}`];
	if (variant.locale) switches.push(`--lang=${variant.locale}`);
	return switches;
}

/** Shows `path` in the app, as `desktop.navigate` says. */
export async function openInApp(
	app: ElectronApplication,
	page: Page,
	how: string | undefined,
	path: string,
	values: Record<string, string>
): Promise<void> {
	if (/^(https?|file):/.test(path)) return navigate(page, path);
	const mode = how ?? 'hash';
	if (mode === 'hash') {
		const hash = `#${path}`;
		await page.evaluate((wanted) => {
			if (location.hash !== wanted) location.hash = wanted;
		}, hash);
		return;
	}
	if (mode.startsWith('ipc:')) {
		const channel = mode.slice(4);
		// As if the window's renderer had sent it: `ipcMain.on(channel, (event, path) => …)` in the app receives it.
		await app.evaluate(
			({ ipcMain, BrowserWindow }, { channel, path }) => {
				const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
				ipcMain.emit(channel, { sender: window?.webContents, reply: () => {} }, path);
			},
			{ channel, path }
		);
		return;
	}
	if (!mode.includes('{path}')) {
		throw new UsageError(
			`desktop.navigate is "${mode}", which isn't something facetshot knows.`,
			'Use "hash", "ipc:<channel>", or a URL with {path} in it (e.g. "http://localhost:5173{path}" or "app://-{path}").'
		);
	}
	await navigate(page, fill(mode, { ...values, path }));
}

/** Sizes the window's content to the device and waits until the page has seen it. */
async function sizeWindow(
	app: ElectronApplication,
	page: Page,
	device: Device
): Promise<string | undefined> {
	const window = await app.browserWindow(page);
	await window.evaluate(
		(win, size) => {
			win.setMinimumSize(1, 1);
			win.setContentSize(size.width, size.height);
		},
		{ width: device.width, height: device.height }
	);
	const deadline = Date.now() + 5000;
	let seen = { width: 0, height: 0 };
	while (Date.now() < deadline) {
		seen = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
		if (seen.width === device.width && seen.height === device.height) return undefined;
		await page.waitForTimeout(50);
	}
	// A window can't be larger than the screen it is on; the picture is still taken, at the size it got.
	return `The window is ${seen.width}×${seen.height}, not ${device.width}×${device.height} (the screen may be too small).`;
}

export class ElectronDriver implements Driver {
	readonly name = 'electron';
	private launch: ElectronLaunch | undefined;

	handles(cell: Cell, config: Config): boolean {
		return (
			config.desktop?.kind === 'electron' &&
			cell.device.platform === 'window' &&
			(cell.target.kind === 'app' || cell.target.kind === 'flow')
		);
	}

	async prepare(_cells: Cell[], ctx: RunContext): Promise<void> {
		const desktop = ctx.config.desktop!;
		if (desktop.build)
			await ensureBuilt('electron', desktop.build, { ...ctx, heavyLock: ctx.locks.build });
		this.launch = resolveLaunch(desktop, ctx.root);
		const playwright = await import('playwright');
		if (!playwright._electron) {
			throw new EnvironmentError(
				"This Playwright has no Electron support (it's missing `_electron`).",
				'Use the playwright package (not playwright-core builds without it), version 1.40 or later.'
			);
		}
	}

	async shoot(cells: Cell[], ctx: RunContext, report: (result: CellResult) => void): Promise<void> {
		for (const group of groupBy(
			cells,
			(cell) => `${cell.variant.name}\u0000${cell.device.scale}`
		)) {
			if (ctx.signal.aborted) {
				for (const cell of group) report(stopped(cell));
				continue;
			}
			await ctx.pools.web
				.run(() => this.shootGroup(group, ctx, report), ctx.signal)
				.catch((error) => {
					for (const cell of group) report(failed(cell, firstLine(error)));
				});
		}
	}

	/** One launch of the app for one variant: every device (window size) and target in it. */
	private async shootGroup(
		group: Cell[],
		ctx: RunContext,
		report: (result: CellResult) => void
	): Promise<void> {
		const desktop = ctx.config.desktop!;
		const web = ctx.config.web;
		const variant = group[0].variant;
		const launch = this.launch!;
		const { _electron } = await import('playwright');
		const env: Record<string, string> = {
			...(process.env as Record<string, string>),
			FACETSHOT: '1'
		};
		for (const [key, value] of Object.entries(desktop.env ?? {}))
			env[key] = fill(value, ctx.values);
		if (variant.timezone) env.TZ = variant.timezone;
		let app: ElectronApplication;
		try {
			app = await _electron.launch({
				executablePath: launch.executablePath,
				args: [...launchSwitches(variant, group[0].device.scale), ...launch.args],
				cwd: ctx.root,
				env,
				timeout: 60_000
			});
		} catch (error) {
			throw new EnvironmentError(
				`The Electron app didn't start: ${firstLine(error)}`,
				`Try it yourself: ${launch.executablePath ?? 'electron'} ${launch.args.join(' ')}`
			);
		}
		// An app that won't close is killed: it is a real window, and a single-instance app would block the next launch.
		const close = async () => {
			if (!(await within(app.close(), 10_000))) app.process().kill('SIGKILL');
		};
		try {
			await app.evaluate(({ nativeTheme }, source) => {
				nativeTheme.themeSource = source;
			}, variant.appearance ?? 'light');
			const context = app.context();
			await context.addInitScript(variantScript(variant, web));
			const blocked = await routeRequests(context, web);
			if (variant.network === 'offline') await context.setOffline(true);
			const page = await app.firstWindow({ timeout: 60_000 });
			await page.emulateMedia({
				...mediaOptions(variant),
				media: variant.media === 'print' ? 'print' : null
			});
			if (web?.clock) await page.clock.setFixedTime(new Date(web.clock));
			// The first page loaded before the init script was added; load it again so the variant is in it from the start.
			await page.waitForLoadState('load');
			await page.reload({ waitUntil: 'load' });
			const watch = new NetworkWatch(page, blocked);
			for (const cells of groupBy(group, (cell) => cell.device.name)) {
				const device = cells[0].device;
				const sizeNote = await sizeWindow(app, page, device);
				const session: PageSession = { page, watch, device, variant };
				for (const cell of cells) {
					if (ctx.signal.aborted) {
						report(stopped(cell));
						continue;
					}
					await shootCell(
						session,
						cell,
						{
							ctx,
							web,
							open: (each, address) =>
								openInApp(app, each.page, desktop.navigate, address, ctx.values)
						},
						(result) =>
							report(sizeNote ? { ...result, notes: [...(result.notes ?? []), sizeNote] } : result)
					);
				}
			}
		} finally {
			await close();
		}
	}
}
