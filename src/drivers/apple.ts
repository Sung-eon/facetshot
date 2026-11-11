/**
 * What the iOS simulator and Mac window drivers share: getting the built app (from facetshot's machine-wide cache
 * when another checkout already built the same sources), turning `app:/path` into a deep link, the app's
 * environment, and waiting for a screen to settle.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { AppleConfig, BuildStep, Variant } from '../types.ts';
import { homeFolder } from '../config.ts';
import { ensureBuilt, stepHash } from '../engine/build.ts';
import { exec, sleep, waitUntil } from '../engine/procs.ts';
import { UsageError } from '../errors.ts';
import { fill } from '../plan.ts';
import type { RunContext } from './driver.ts';

export interface BuiltApp {
	/** The .app to install or run. */
	path: string;
	/** Changes whenever the app does: decides whether a simulator needs it installed again. */
	key: string;
}

/** Built apps kept per inputs hash, newest first; older ones are removed past this many. */
const KEEP_APPS = 6;

/**
 * The app for one side (iOS or Mac). A prebuilt path is used as it is. A build step runs only when its inputs
 * changed, and its result is copied to `~/.facetshot/cache/apps/<hash>/`, where any checkout with identical inputs
 * finds it and builds nothing.
 */
export async function obtainApp(
	what: string,
	source: { app?: string; build?: BuildStep } | undefined,
	ctx: RunContext
): Promise<BuiltApp> {
	if (source?.app) {
		const path = resolve(ctx.root, fill(source.app, ctx.values));
		if (!existsSync(path))
			throw new UsageError(
				`${what}.app points at ${path}, which doesn't exist.`,
				'Build the app first, or give a build step instead.'
			);
		return { path, key: `${path}@${statSync(path).mtimeMs}` };
	}
	const step = source?.build;
	if (!step) {
		throw new UsageError(
			`facetshot doesn't know where the ${what} app is.`,
			`Set ${what}.app (a built .app) or ${what}.build (a command and its inputs) in facetshot.config.ts.`
		);
	}
	if (!step.output) {
		throw new UsageError(
			`${what}.build has no output.`,
			'Set output to the .app the build produces (relative to the config).'
		);
	}
	// The same hash ensureBuilt keeps, so the shared cache and the checkout's own stamp agree.
	const hash = stepHash(step, ctx);
	const shared = join(homeFolder(), 'cache', 'apps', hash);
	const output = resolve(ctx.root, fill(step.output, ctx.values));
	const cached = join(shared, basename(output));
	if (existsSync(join(shared, '.complete')) && existsSync(cached)) {
		const now = new Date();
		utimesSync(join(shared, '.complete'), now, now);
		return { path: cached, key: hash };
	}
	const built = await ensureBuilt(
		what.replace(/\W+/g, '-'),
		{ ...step, heavy: step.heavy ?? true },
		{ ...ctx, heavyLock: ctx.locks.build }
	);
	if (!built.output || !existsSync(built.output)) {
		throw new UsageError(
			`The ${what} build finished but ${output} isn't there.`,
			`Point ${what}.build.output at the .app the build makes.`
		);
	}
	// Copied beside, then moved in whole: another checkout never sees half an app.
	const partial = `${shared}.partial-${process.pid}`;
	rmSync(partial, { recursive: true, force: true });
	mkdirSync(partial, { recursive: true });
	await exec('ditto', [built.output, join(partial, basename(output))]);
	writeFileSync(join(partial, '.complete'), new Date().toISOString());
	try {
		renameSync(partial, shared);
	} catch {
		// Another checkout put the same app there first.
		rmSync(partial, { recursive: true, force: true });
	}
	pruneApps();
	return { path: existsSync(cached) ? cached : built.output, key: hash };
}

function pruneApps(): void {
	const folder = join(homeFolder(), 'cache', 'apps');
	const entries = readdirSync(folder)
		.filter((name) => existsSync(join(folder, name, '.complete')))
		.map((name) => ({ name, at: statSync(join(folder, name, '.complete')).mtimeMs }))
		.sort((a, b) => b.at - a.at);
	for (const entry of entries.slice(KEEP_APPS))
		rmSync(join(folder, entry.name), { recursive: true, force: true });
}

/** `app:/book/page/1` as the app's deep link: `scheme:///book/page/1`, or `scheme://book/page/1` with the host style. */
export function deepLink(
	apple: Pick<AppleConfig, 'scheme' | 'deepLinkStyle'> | undefined,
	address: string,
	scheme = apple?.scheme
): string {
	// A flow's `start: app:/book` is the same screen as the target `app:/book`.
	address = address.replace(/^app:/, '');
	if (/^[a-z][\w+.-]*:/i.test(address)) return address;
	if (!scheme) {
		throw new UsageError(
			'app: targets open screens by deep link, and no URL scheme is set.',
			'Set apple.scheme (e.g. "myapp") in facetshot.config.ts.'
		);
	}
	const path = address.startsWith('/') ? address : `/${address}`;
	return apple?.deepLinkStyle === 'host' ? `${scheme}:/${path}` : `${scheme}://${path}`;
}

/** The app's environment for one launch: the config's, filled in, plus what the variant asks of it through `variantEnv`. */
export function appEnv(
	base: Record<string, string> | undefined,
	apple: AppleConfig | undefined,
	variant: Variant | undefined,
	values: Record<string, string>
) {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(base ?? {})) env[key] = fill(value, values);
	if (variant && apple?.variantEnv) {
		for (const axis of ['appearance', 'text'] as const) {
			const value = variant[axis];
			const extra = value ? apple.variantEnv[axis]?.[value] : undefined;
			for (const [key, setting] of Object.entries(extra ?? {})) env[key] = fill(setting, values);
		}
	}
	return env;
}

/** Waits for a file to appear. False when it didn't within the time. */
export const waitForFile = (file: string, timeout: number, signal?: AbortSignal) =>
	waitUntil(() => existsSync(file), timeout, { every: 50, signal });

/**
 * The executable inside a macOS `.app` bundle, from its Info.plist (or the bundle's own name). Xcode writes binary
 * plists, which only PlistBuddy reads; a hand-made or Electron bundle's is XML.
 */
export function bundleExecutable(app: string): string {
	const plist = join(app, 'Contents', 'Info.plist');
	let name: string | undefined;
	if (existsSync(plist)) {
		const text = readFileSync(plist, 'latin1');
		name = /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/.exec(text)?.[1];
		if (!name && text.startsWith('bplist') && process.platform === 'darwin') {
			try {
				name = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', plist], {
					encoding: 'utf8'
				}).trim();
			} catch {
				// Fall back to the bundle's name.
			}
		}
	}
	return join(app, 'Contents', 'MacOS', name || basename(app).replace(/\.app$/, ''));
}

export interface Settled {
	stable: boolean;
	ms: number;
}

/**
 * Takes screenshots until two in a row, `gap` ms apart, are the same: the screen has stopped changing. Gives up after
 * `cap` ms and keeps the last one. A screen that never stops (a spinner, a clock with seconds) costs the whole cap.
 * The kept screenshot ends up in `file`; the scratch screenshots beside it are removed.
 */
export async function settle(
	take: (file: string) => Promise<void>,
	file: string,
	options: { gap?: number; cap: number; signal?: AbortSignal }
): Promise<Settled> {
	const started = Date.now();
	const gap = options.gap ?? 250;
	const files = [`${file}.tmp.a.png`, `${file}.tmp.b.png`];
	let turn = 0;
	try {
		await take(files[turn]);
		let last = digest(files[turn]);
		for (;;) {
			options.signal?.throwIfAborted();
			await sleep(gap);
			turn = 1 - turn;
			await take(files[turn]);
			const now = digest(files[turn]);
			const stable = now === last;
			if (stable || Date.now() - started > options.cap) {
				renameSync(files[turn], file);
				return { stable, ms: Date.now() - started };
			}
			last = now;
		}
	} finally {
		for (const scratch of files) rmSync(scratch, { force: true });
	}
}

function digest(file: string): string {
	return createHash('sha1').update(readFileSync(file)).digest('hex');
}

/** A label for what a flow's selector points at, the way an accessibility tree names it: `text=Save`, `role=button[name='Save']`, `#save`. */
export function selectorLabel(selector: string): string {
	const named = selector.match(/name\s*=\s*['"]([^'"]+)['"]/);
	if (named) return named[1];
	const text = selector.match(/^text\s*=\s*['"]?(.+?)['"]?$/);
	if (text) return text[1];
	const aria = selector.match(/aria-label\s*=\s*['"]([^'"]+)['"]/);
	if (aria) return aria[1];
	if (/^#[\w-]+$/.test(selector)) return selector.slice(1);
	return selector;
}
