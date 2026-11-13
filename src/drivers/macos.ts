/**
 * A native Mac app's window, pictured by the system's window capture: the app is launched from its binary (so it gets
 * an environment, and a home of facetshot's own instead of the person's settings) once per screenshot, on the screen
 * FACETSHOT_ROUTE names (the deep link), sized to the device, and its window captured by its id, never the screen
 * around it.
 *
 * A Mac has no outside switch for an app's appearance or text size the way a simulator does, so the app is launched
 * again for each variant, told through its environment (FACETSHOT_APPEARANCE, FACETSHOT_TEXT, and `apple.variantEnv`)
 * and, for appearance, the system's own `-AppleInterfaceStyle Dark` argument, which AppKit apps follow.
 *
 * Permissions: capturing a window needs Screen Recording for whatever runs facetshot (the terminal, or the agent's
 * app). Sizing the window from outside, for an app that doesn't read FACETSHOT_WINDOW_SIZE, uses System Events and
 * needs Accessibility as well; without it the screenshot is taken at the app's own size, with a note.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import type { BuildStep, Cell, CellResult, Config, Device, Variant } from '../types.ts';
import { homeFolder } from '../config.ts';
import { withLock } from '../engine/lock.ts';
import { exec, sleep, spawnGroup, stopGroup, waitUntil } from '../engine/procs.ts';
import { EnvironmentError, firstLine, UsageError } from '../errors.ts';
import { loadFlow, shotNames } from '../flows.ts';
import {
	appEnv,
	bundleExecutable,
	deepLink,
	obtainApp,
	settle,
	waitForFile,
	type BuiltApp
} from './apple.ts';
import {
	byDeviceAndVariant,
	failed,
	failRest,
	fillAddress,
	groupBy,
	reporter,
	result,
	stopped,
	unreadable,
	notApplied,
	type Driver,
	type RunContext
} from './driver.ts';
import { pngSize, imagePath } from './page.ts';

const HELPER_SOURCE = join(import.meta.dirname, 'mac-windows.swift');
const READY_TIMEOUT = 15_000;

/** The window finder, compiled once per change of its source into ~/.facetshot/bin. */
async function helper(log: (message: string) => void = () => {}): Promise<string> {
	const source = readFileSync(HELPER_SOURCE);
	const binary = join(
		homeFolder(),
		'bin',
		`mac-windows-${createHash('sha256').update(source).digest('hex').slice(0, 12)}`
	);
	if (existsSync(binary)) return binary;
	log('Compiling the window finder (once)…');
	mkdirSync(dirname(binary), { recursive: true });
	try {
		await exec('xcrun', ['swiftc', '-O', HELPER_SOURCE, '-o', `${binary}.partial`]);
	} catch (error) {
		throw new EnvironmentError(
			`Couldn't compile ${HELPER_SOURCE}: ${(error as { stderr?: string }).stderr?.trim() || (error as Error).message}`,
			'Install the Xcode command line tools (xcode-select --install).'
		);
	}
	renameSync(`${binary}.partial`, binary);
	return binary;
}

let recordingGranted = false;

/** Throws what to do when this process may not record the screen (and so can't capture any window). */
async function mayRecord(finder: string): Promise<void> {
	if (recordingGranted) return;
	const { stdout } = await exec(finder, ['check']);
	if (stdout.trim() !== 'granted') {
		throw new EnvironmentError(
			"facetshot may not record the screen, so it can't take screenshots of a window.",
			"Allow it in System Settings → Privacy & Security → Screen & System Audio Recording, for the app facetshot runs in (your terminal, or the agent's app), then restart that app."
		);
	}
	recordingGranted = true;
}

/**
 * Screenshots the largest window a process has on screen (its main window, not a sheet or panel beside it), and only
 * that window. Waits up to 10 s for one to appear. For any driver that launches a Mac app itself (Tauri's real window).
 */
export async function captureMacWindow(
	pid: number,
	file: string,
	ctx?: Pick<RunContext, 'log'>
): Promise<{ width: number; height: number }> {
	const finder = await helper(ctx?.log);
	await mayRecord(finder);
	if (
		!(await waitUntil(async () => (await windows(finder, pid)).length > 0, 10_000, { every: 200 }))
	)
		throw new Error(`Process ${pid} has no window on screen to take a screenshot of.`);
	await capture(finder, pid, file);
	return pngSize(file);
}

/** Screenshots a process's largest window (its main window, not a sheet or a panel beside it) into `file`. */
async function capture(finder: string, pid: number, file: string): Promise<void> {
	const window = (await windows(finder, pid)).at(-1);
	if (!window) throw new Error('The app has no window on screen any more.');
	await exec('screencapture', ['-x', '-o', '-l', String(window.id), file]);
}

interface Launched {
	pid: number;
	/** Whether the app wrote its ready file in time; undefined when it isn't asked to. */
	ready: boolean | undefined;
	/** Why the window isn't the device's size, when it isn't. */
	sizeNote?: string;
	stop(): Promise<void>;
}

/** Launches the app on a deep link. */
type Launcher = (route: string) => Promise<Launched>;

interface Window {
	id: number;
	width: number;
	height: number;
}

async function windows(finder: string, pid: number): Promise<Window[]> {
	const { stdout } = await exec(finder, [String(pid)]);
	return stdout
		.trim()
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const [id, width, height] = line.split(' ').map(Number);
			return { id, width, height };
		});
}

/** What the Mac side of the config says: the desktop section when it's a Mac app, else `apple.macos`. */
function macSettings(config: Config) {
	const desktop = config.desktop?.kind === 'macos' ? config.desktop : undefined;
	const source: { app?: string; build?: BuildStep } | undefined = desktop
		? { app: desktop.app, build: desktop.build }
		: config.apple?.macos;
	return {
		what: desktop ? 'desktop' : 'apple.macos',
		source,
		scheme: desktop?.navigate ?? config.apple?.scheme,
		env: { ...(config.apple?.env ?? {}), ...(desktop?.env ?? {}) },
		args: desktop?.args ?? config.apple?.args ?? [],
		readyFile: desktop?.readyFile ?? config.apple?.readyFile ?? false
	};
}

export class MacWindowDriver implements Driver {
	readonly name = 'Mac window';
	private app: BuiltApp | undefined;
	private finder = '';

	handles(cell: Cell, config: Config): boolean {
		const mac = config.desktop?.kind === 'macos' || (!config.desktop && !!config.apple?.macos);
		return (
			(cell.target.kind === 'app' || cell.target.kind === 'flow') &&
			cell.device.platform === 'window' &&
			mac
		);
	}

	async prepare(cells: Cell[], ctx: RunContext): Promise<void> {
		if (process.platform !== 'darwin')
			throw new EnvironmentError('Mac app windows can only be captured on a Mac.');
		const settings = macSettings(ctx.config);
		const [app, finder] = await Promise.all([
			obtainApp(settings.what, settings.source, ctx),
			helper(ctx.log)
		]);
		this.app = app;
		this.finder = finder;
		await mayRecord(finder);
	}

	async shoot(cells: Cell[], ctx: RunContext, report: (result: CellResult) => void): Promise<void> {
		// One app window run at a time on this Mac: another run's windows would come and go under this one's.
		await withLock(
			ctx.locks.macWindow,
			`facetshot Mac windows in ${ctx.root}`,
			async () => {
				for (const group of groupBy(cells, byDeviceAndVariant)) {
					const tell = reporter(report);
					try {
						await this.session(group[0].device, group[0].variant, group, ctx, (result, cell) =>
							tell.report(cell, result)
						);
					} catch (error) {
						tell.failRest(group, error);
					}
				}
			},
			{ onWait: ctx.log, signal: ctx.signal, poll: 3000 }
		);
	}

	/** A device's size in one variant: every target in it, each its own launch. */
	private async session(
		device: Device,
		variant: Variant,
		cells: Cell[],
		ctx: RunContext,
		report: (result: CellResult, cell: Cell) => void
	): Promise<void> {
		const settings = macSettings(ctx.config);
		const app = this.app!;
		const readyFile = join(ctx.stateDir, 'ready', 'mac.ready');
		mkdirSync(dirname(readyFile), { recursive: true });
		rmSync(readyFile, { force: true });
		const home = join(ctx.stateDir, 'mac-home');
		mkdirSync(home, { recursive: true });

		const dark = variant.appearance === 'dark';
		const env: Record<string, string> = {
			...(process.env as Record<string, string>),
			...appEnv(settings.env, ctx.config.apple, variant, ctx.values),
			// Settings and saved state of this run's own, never the person's.
			CFFIXED_USER_HOME: home,
			FACETSHOT_WINDOW_SIZE: `${device.width}x${device.height}`,
			FACETSHOT_APPEARANCE: dark ? 'dark' : 'light',
			...(variant.text && variant.text !== 'default' ? { FACETSHOT_TEXT: variant.text } : {}),
			...(settings.readyFile ? { FACETSHOT_READY_FILE: readyFile } : {})
		};
		const notes: string[] = [];
		if (variant.text && variant.text !== 'default')
			notes.push(
				`Text size is up to the app on a Mac (FACETSHOT_TEXT=${variant.text}); facetshot can't check it took.`
			);
		notes.push(...notApplied(variant, ['appearance', 'text'], 'on a Mac window'));

		const binary = this.executable(app.path);
		const args = [
			'-ApplePersistenceIgnoreState',
			'YES',
			...(dark ? ['-AppleInterfaceStyle', 'Dark'] : []),
			...settings.args
		];
		const launch: Launcher = (route) =>
			this.launch(
				binary,
				args,
				{ ...env, FACETSHOT_ROUTE: route },
				device,
				readyFile,
				settings.readyFile,
				ctx
			);
		for (const cell of cells) {
			if (ctx.signal.aborted) {
				report(stopped(cell), cell);
				continue;
			}
			if (!ctx.images) {
				report(unreadable(cell, 'a window'), cell);
				continue;
			}
			await this.shootCell(cell, launch, settings, notes, ctx, (result) => report(result, cell));
		}
	}

	/**
	 * Starts the app on one screen and waits for its window. The screen is given at launch (FACETSHOT_ROUTE, the deep
	 * link) rather than opened afterwards: a SwiftUI app answers a link from outside with a new window of its default
	 * size, not the one facetshot sized. So each screenshot is its own launch, a second or two on a Mac.
	 */
	private async launch(
		binary: string,
		args: string[],
		env: Record<string, string>,
		device: Device,
		readyFile: string,
		readyWanted: boolean,
		ctx: RunContext
	): Promise<Launched> {
		rmSync(readyFile, { force: true });
		const child = spawnGroup(binary, args, { env });
		const pid = child.pid;
		if (!pid) throw new EnvironmentError(`Couldn't start ${binary}.`);
		const stop = () => stopGroup(pid, 3000);
		try {
			// A window can be a long time coming on a busy machine.
			const shown = await waitUntil(
				async () => child.exitCode !== null || (await windows(this.finder, pid)).length > 0,
				60_000,
				{ every: 200, signal: ctx.signal }
			);
			if (child.exitCode !== null)
				throw new EnvironmentError(
					`${basename(binary)} quit as it started (exit ${child.exitCode}).`,
					`Run it yourself to see why: ${binary}`
				);
			if (!shown) throw new EnvironmentError(`${basename(binary)} showed no window within 60 s.`);
			const ready = readyWanted
				? await waitForFile(readyFile, READY_TIMEOUT, ctx.signal)
				: undefined;
			return { pid, ready, stop, sizeNote: await this.size(pid, device, ctx) };
		} catch (error) {
			await stop();
			throw error;
		}
	}

	/** The binary inside the .app, from its Info.plist. */
	private executable(app: string): string {
		const binary = bundleExecutable(app);
		if (!existsSync(binary))
			throw new UsageError(
				`${app} has no executable at ${binary}.`,
				'Point the config at a built Mac .app.'
			);
		return binary;
	}

	/** Makes the window the device's size if the app didn't size itself from FACETSHOT_WINDOW_SIZE, through System Events. */
	private async size(pid: number, device: Device, ctx: RunContext): Promise<string | undefined> {
		const fits = async () => {
			const window = (await windows(this.finder, pid)).at(-1);
			// The frame holds a title bar the content size doesn't: within a toolbar's height is the size asked for.
			return (
				!!window && window.width === device.width && Math.abs(window.height - device.height) <= 80
			);
		};
		if (await fits()) return undefined;
		const script =
			`tell application "System Events" to tell (first process whose unix id is ${pid}) to ` +
			`set size of window 1 to {${device.width}, ${device.height}}`;
		try {
			await exec('osascript', ['-e', script], { timeout: 10_000 });
			await sleep(400);
		} catch (error) {
			ctx.log(
				`Couldn't size the window from outside: ${(error as { stderr?: string }).stderr?.trim() || (error as Error).message}`
			);
		}
		if (await fits()) return undefined;
		const window = (await windows(this.finder, pid)).at(-1);
		return (
			`The window is ${window?.width}×${window?.height}, not ${device.width}×${device.height}: the app doesn't read FACETSHOT_WINDOW_SIZE ` +
			'and sizing it from outside needs Accessibility for what runs facetshot (System Settings → Privacy & Security → Accessibility).'
		);
	}

	private async shootCell(
		cell: Cell,
		launch: Launcher,
		settings: ReturnType<typeof macSettings>,
		notes: string[],
		ctx: RunContext,
		report: (result: CellResult) => void
	): Promise<void> {
		const started = Date.now();
		let running: Launched | undefined;
		const open = async (address: string) => {
			const filled = fillAddress(cell, address, ctx.values);
			await running?.stop();
			running = await launch(deepLink(ctx.config.apple, filled, settings.scheme));
		};
		const picture = async (screen: string) => {
			const extra = [...notes];
			const pid = running!.pid;
			const ready = running!.ready;
			if (running!.sizeNote) extra.push(running!.sizeNote);
			if (ready === false)
				extra.push(
					`The app didn't write its ready file within ${READY_TIMEOUT / 1000} s; shot when the window stopped changing.`
				);
			if (ready === undefined) await sleep(500);
			const { file, rel } = imagePath(ctx.runDir, screen, cell.device.name, cell.variant.name);
			const settled = await settle((to) => capture(this.finder, pid, to), file, {
				cap: ready ? 3000 : 8000,
				signal: ctx.signal
			});
			if (!settled.stable)
				extra.push(
					`Still changing after ${(settled.ms / 1000).toFixed(1)} s; this is the last screenshot.`
				);
			report({
				...result(cell, { screen }),
				image: rel,
				...pngSize(file),
				ms: Date.now() - started,
				readyTimedOut: ready === false || !settled.stable ? true : undefined,
				notes: extra.length ? extra : undefined
			});
		};

		try {
			await this.play(cell, ctx.root, open, picture, started, report);
		} finally {
			await running?.stop();
		}
	}

	private async play(
		cell: Cell,
		root: string,
		open: (address: string) => Promise<void>,
		picture: (screen: string) => Promise<void>,
		started: number,
		report: (result: CellResult) => void
	): Promise<void> {
		if (cell.target.kind !== 'flow') {
			try {
				await open(cell.sceneId ?? cell.target.value);
				await picture(cell.screen);
			} catch (error) {
				report(failed(cell, firstLine(error), Date.now() - started));
			}
			return;
		}
		const flow = loadFlow(cell.target.value, root);
		const names = shotNames(flow);
		let shots = 0;
		try {
			await open(flow.start);
			for (const [index, step] of flow.steps.entries()) {
				if ('shot' in step) {
					shots += 1;
					await picture(`${cell.screen}.${step.shot}`);
				} else if ('goto' in step) {
					await open(step.goto);
				} else {
					throw new Error(
						`step ${index + 1} of ${flow.name} (${JSON.stringify(step)}): a Mac window can only be opened on a deep link (goto) and captured (shot); ` +
							'pressing and typing in a native Mac app is not supported.'
					);
				}
			}
			if (!shots) {
				shots += 1;
				await picture(`${cell.screen}.end`);
			}
		} catch (error) {
			failRest(cell, names, shots, error, started, report);
		}
	}
}
