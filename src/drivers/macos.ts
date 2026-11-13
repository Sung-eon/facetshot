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
import { homeFolder, ownEnvironment } from '../config.ts';
import { withLock } from '../engine/lock.ts';
import { exec, sleep, spawnGroup, stopGroup, waitUntil } from '../engine/procs.ts';
import { EnvironmentError, firstLine, UsageError } from '../errors.ts';
import { loadFlow, shotNames, type Step } from '../flows.ts';
import { MacUi } from './mac-ui.ts';
import { LogBook, recordOutput, recordSystemLog } from '../logs.ts';
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
	keepLog,
	notApplied,
	type Driver,
	type RunContext
} from './driver.ts';
import { pngSize, imagePath } from './page.ts';

const HELPER_SOURCE = join(import.meta.dirname, 'mac-helper.swift');
const READY_TIMEOUT = 15_000;

/** The window helper, compiled once per change of its source into ~/.facetshot/bin. */
export async function helper(log: (message: string) => void = () => {}): Promise<string> {
	const source = readFileSync(HELPER_SOURCE);
	const binary = join(
		homeFolder(),
		'bin',
		`mac-helper-${createHash('sha256').update(source).digest('hex').slice(0, 12)}`
	);
	if (existsSync(binary)) return binary;
	log('Compiling the Mac window helper (once)…');
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

/** Screenshots a process's largest window (its main window, not a sheet or a panel beside it) into `file`. */
async function capture(finder: string, pid: number, file: string): Promise<void> {
	const window = (await windows(finder, pid)).at(-1);
	if (!window) throw new Error('The app has no window on screen any more.');
	await exec('screencapture', ['-x', '-o', '-l', String(window.id), file]);
}

export interface Launched {
	pid: number;
	/** Whether the app wrote its ready file in time; undefined when it isn't asked to. */
	ready: boolean | undefined;
	/** Why the window isn't the device's size, when it isn't. */
	sizeNote?: string;
	/** What the app printed and wrote to the system log since it started. */
	log: LogBook;
	stop(): Promise<void>;
}

export interface Window {
	id: number;
	width: number;
	height: number;
	/** Its top left on the screen, in points. */
	x: number;
	y: number;
}

export async function windows(finder: string, pid: number): Promise<Window[]> {
	const { stdout } = await exec(finder, [String(pid)]);
	return stdout
		.trim()
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const [id, width, height, x, y] = line.split(' ').map(Number);
			return { id, width, height, x, y };
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

/** The configured Mac app, built or found, and the helper that captures and drives its windows. */
export interface MacApp {
	app: BuiltApp;
	finder: string;
}

export async function prepareMac(ctx: RunContext): Promise<MacApp> {
	if (process.platform !== 'darwin')
		throw new EnvironmentError('Mac app windows can only be captured on a Mac.');
	const settings = macSettings(ctx.config);
	const [app, finder] = await Promise.all([
		obtainApp(settings.what, settings.source, ctx),
		helper(ctx.log)
	]);
	await mayRecord(finder);
	return { app, finder };
}

/**
 * How to launch the app on one device in one variant, and the notes every screenshot of it carries. The screen is
 * given at launch (FACETSHOT_ROUTE, the deep link) rather than opened afterwards: a SwiftUI app answers a link from
 * outside with a new window of its default size, not the one facetshot sized. So each screen is its own launch, a
 * second or two on a Mac.
 */
export function macLauncher(
	mac: MacApp,
	device: Device,
	variant: Variant,
	ctx: RunContext
): { launch: (address: string, log?: LogBook) => Promise<Launched>; notes: string[] } {
	const settings = macSettings(ctx.config);
	const readyFile = join(ctx.stateDir, 'ready', 'mac.ready');
	mkdirSync(dirname(readyFile), { recursive: true });
	const home = join(ctx.stateDir, 'mac-home');
	mkdirSync(home, { recursive: true });
	const dark = variant.appearance === 'dark';
	const env: Record<string, string> = {
		...ownEnvironment(),
		...appEnv(settings.env, ctx.config.apple, variant, ctx.values),
		// Settings and saved state of this run's own, never the person's.
		CFFIXED_USER_HOME: home,
		// Swift's print reaches a pipe as it happens, not when the app quits (Xcode sets the same).
		NSUnbufferedIO: 'YES',
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
	const binary = executable(mac.app.path);
	const args = [
		'-ApplePersistenceIgnoreState',
		'YES',
		...(dark ? ['-AppleInterfaceStyle', 'Dark'] : []),
		...settings.args
	];
	const launch = (address: string, log?: LogBook) => {
		// The route is given at launch, so an app without a URL scheme gets the path itself.
		const route = settings.scheme
			? deepLink(ctx.config.apple, address, settings.scheme)
			: address.replace(/^app:/, '');
		return launchMac(mac, binary, args, { ...env, FACETSHOT_ROUTE: route }, device, {
			readyFile,
			readyWanted: settings.readyFile,
			ctx,
			log
		});
	};
	return { launch, notes };
}

/** Starts the app and waits for its window, with a log of what it prints and writes to the system log. */
async function launchMac(
	mac: MacApp,
	binary: string,
	args: string[],
	env: Record<string, string>,
	device: Device,
	options: { readyFile: string; readyWanted: boolean; ctx: RunContext; log?: LogBook }
): Promise<Launched> {
	const { readyFile, readyWanted, ctx } = options;
	rmSync(readyFile, { force: true });
	// A session keeps one log across launches; a run's screenshot has the launch's own.
	const log = options.log ?? new LogBook();
	let pid: number | undefined;
	// Started first, so the app's first lines are in it.
	const stopSystemLog = recordSystemLog(basename(binary), basename(mac.app.path), log, {
		pid: () => pid
	});
	const child = spawnGroup(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
	pid = child.pid;
	if (!pid) {
		stopSystemLog();
		throw new EnvironmentError(`Couldn't start ${binary}.`);
	}
	// AppKit's note about the -ApplePersistenceIgnoreState facetshot passes is facetshot's, not the app's.
	recordOutput(child, log, { skip: /ApplePersistenceIgnoreState/ });
	const running = pid;
	const stop = async () => {
		await stopGroup(running, 3000);
		stopSystemLog();
	};
	try {
		// A window can be a long time coming on a busy machine.
		const shown = await waitUntil(
			async () => child.exitCode !== null || (await windows(mac.finder, running)).length > 0,
			60_000,
			{ every: 200, signal: ctx.signal }
		);
		if (child.exitCode !== null)
			throw new EnvironmentError(
				`${basename(binary)} quit as it started (exit ${child.exitCode}).`,
				`Run it yourself to see why: ${binary}`
			);
		if (!shown) throw new EnvironmentError(`${basename(binary)} showed no window within 60 s.`);
		const ready = readyWanted ? await waitForFile(readyFile, READY_TIMEOUT, ctx.signal) : undefined;
		return {
			pid: running,
			ready,
			stop,
			log,
			sizeNote: await sizeMacWindow(mac.finder, running, device, ctx)
		};
	} catch (error) {
		await stop();
		throw error;
	}
}

/** The binary inside the .app, from its Info.plist. */
function executable(app: string): string {
	const binary = bundleExecutable(app);
	if (!existsSync(binary))
		throw new UsageError(
			`${app} has no executable at ${binary}.`,
			'Point the config at a built Mac .app.'
		);
	return binary;
}

/** Makes the window the device's size if the app didn't size itself from FACETSHOT_WINDOW_SIZE, through System Events. */
async function sizeMacWindow(
	finder: string,
	pid: number,
	device: Device,
	ctx: RunContext
): Promise<string | undefined> {
	const fits = async () => {
		const window = (await windows(finder, pid)).at(-1);
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
	const window = (await windows(finder, pid)).at(-1);
	return (
		`The window is ${window?.width}×${window?.height}, not ${device.width}×${device.height}: the app doesn't read FACETSHOT_WINDOW_SIZE ` +
		'and sizing it from outside needs Accessibility for what runs facetshot (System Settings → Privacy & Security → Accessibility).'
	);
}

/** A screenshot of the app's window once it has stopped changing, with the notes that belong to it. */
export async function shootMacWindow(
	finder: string,
	running: Launched,
	file: string,
	signal?: AbortSignal
): Promise<{ notes: string[]; timedOut: boolean }> {
	const notes: string[] = [];
	if (running.sizeNote) notes.push(running.sizeNote);
	if (running.ready === false)
		notes.push(
			`The app didn't write its ready file within ${READY_TIMEOUT / 1000} s; shot when the window stopped changing.`
		);
	if (running.ready === undefined) await sleep(500);
	const settled = await settle((to) => capture(finder, running.pid, to), file, {
		cap: running.ready ? 3000 : 8000,
		signal
	});
	if (!settled.stable)
		notes.push(
			`Still changing after ${(settled.ms / 1000).toFixed(1)} s; this is the last screenshot.`
		);
	return { notes, timedOut: running.ready === false || !settled.stable };
}

export class MacWindowDriver implements Driver {
	readonly name = 'Mac window';
	private mac: MacApp | undefined;

	handles(cell: Cell, config: Config): boolean {
		return (
			(cell.target.kind === 'app' || cell.target.kind === 'flow') &&
			cell.device.platform === 'window' &&
			isMacApp(config)
		);
	}

	async prepare(_cells: Cell[], ctx: RunContext): Promise<void> {
		this.mac = await prepareMac(ctx);
	}

	async shoot(cells: Cell[], ctx: RunContext, report: (result: CellResult) => void): Promise<void> {
		// One app window run at a time on this Mac: another run's windows would come and go under this one's.
		await withLock(
			ctx.locks.macWindow,
			`facetshot Mac windows in ${ctx.root}`,
			async () => {
				for (const group of groupBy(cells, byDeviceAndVariant)) {
					const tell = reporter(report);
					const { launch, notes } = macLauncher(this.mac!, group[0].device, group[0].variant, ctx);
					for (const cell of group) {
						if (ctx.signal.aborted) tell.report(cell, stopped(cell));
						else if (!ctx.images) tell.report(cell, unreadable(cell, 'a window'));
						else await this.shootCell(cell, launch, notes, ctx, (out) => tell.report(cell, out));
					}
				}
			},
			{ onWait: ctx.log, signal: ctx.signal, poll: 3000 }
		);
	}

	private async shootCell(
		cell: Cell,
		launch: (address: string) => Promise<Launched>,
		notes: string[],
		ctx: RunContext,
		report: (result: CellResult) => void
	): Promise<void> {
		const started = Date.now();
		let running: Launched | undefined;
		const open = async (address: string) => {
			await running?.stop();
			running = undefined;
			running = await launch(fillAddress(cell, address, ctx.values));
		};
		const picture = async (screen: string) => {
			const { file, rel } = imagePath(ctx.runDir, screen, cell.device.name, cell.variant.name);
			const shot = await shootMacWindow(this.mac!.finder, running!, file, ctx.signal);
			const extra = [...notes, ...shot.notes];
			const out: CellResult = {
				...result(cell, { screen }),
				image: rel,
				...pngSize(file),
				ms: Date.now() - started,
				readyTimedOut: shot.timedOut ? true : undefined,
				notes: extra.length ? extra : undefined
			};
			keepLog(ctx, out, running!.log, started);
			report(out);
		};
		// Steps that move the pointer or type go to the front app: one Mac window run at a time holds the screen.
		const act = async (step: Step) => (await MacUi.of(running!.pid, ctx.log)).step(step);
		try {
			await playOnMac(cell, ctx.root, { open, act, picture }, started, report);
		} finally {
			await running?.stop();
		}
	}
}

/** Whether `window` devices show a native Mac app: the desktop section says so, or there's only `apple.macos`. */
export function isMacApp(config: Config): boolean {
	return config.desktop?.kind === 'macos' || (!config.desktop && !!config.apple?.macos);
}

/** How a flow is played in a Mac window, whoever launched the app. */
export interface MacPlayer {
	/** Shows an address: a deep link, or a fresh launch on it. */
	open: (address: string) => Promise<void>;
	/** Does one step other than `goto` and `shot`. */
	act: (step: Step) => Promise<void>;
	/** Takes the screenshot for a screen name. */
	picture: (screen: string) => Promise<void>;
}

/** A screen or a flow in a Mac window: native Mac apps and Tauri's real window both play it this way. */
export async function playOnMac(
	cell: Cell,
	root: string,
	player: MacPlayer,
	started: number,
	report: (result: CellResult) => void
): Promise<void> {
	if (cell.target.kind !== 'flow') {
		try {
			await player.open(cell.sceneId ?? cell.target.value);
			await player.picture(cell.screen);
		} catch (error) {
			report(failed(cell, firstLine(error), Date.now() - started));
		}
		return;
	}
	const flow = loadFlow(cell.target.value, root);
	const names = shotNames(flow);
	let shots = 0;
	try {
		await player.open(flow.start);
		for (const [index, step] of flow.steps.entries()) {
			try {
				if ('shot' in step) {
					shots += 1;
					await player.picture(`${cell.screen}.${step.shot}`);
				} else if ('goto' in step) await player.open(step.goto);
				else await player.act(step);
			} catch (error) {
				throw new Error(
					`step ${index + 1} of ${flow.name} (${JSON.stringify(step)}) didn't work: ${firstLine(error)}`,
					{ cause: error }
				);
			}
		}
		if (!shots) {
			shots += 1;
			await player.picture(`${cell.screen}.end`);
		}
	} catch (error) {
		failRest(cell, names, shots, error, started, report);
	}
}
