/**
 * One run, start to finish: plan the pictures, get servers and test data ready, hand the cells to the drivers, then
 * compare, draw the sheets and write the manifest.
 */
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	unlinkSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Cell, CellResult, Config, Manifest } from './types.ts';
import { plan, type PlanRequest } from './plan.ts';
import { inlineFlow, type Step } from './flows.ts';
import { Runtime } from './engine/runtime.ts';
import { Pool } from './engine/scheduler.ts';
import { ensureService, within } from './engine/procs.ts';
import { expandHome, homeFolder } from './config.ts';
import { prepareFixtures } from './fixtures.ts';
import { diffImages } from './output/diff.ts';
import { drawSheet } from './output/sheet.ts';
import { writeManifest } from './output/manifest.ts';
import { explain, UsageError } from './errors.ts';
import { failed, type Driver, type RunContext } from './drivers/driver.ts';
import { createDrivers } from './drivers/index.ts';
import { ALL_CHECKS } from './checks/page.ts';

export interface RunRequest extends PlanRequest {
	/** Steps to play on every target before its picture (clicks, typing…); each `shot` step is a picture. */
	steps?: Step[];
	/** Read the screens and report findings; take no pictures. */
	checkOnly?: boolean;
	/** Checks to run (default: the config's, or console + network). `all` for every check. */
	checks?: string[];
	/** Compare with `previous` (the last run), a baseline name, or a run folder. */
	diff?: string;
	/** A folder for this run instead of `.facetshot/runs/<id>`. */
	out?: string;
	/** Empty the output folder first. */
	clean?: boolean;
	/** Contact sheet width. */
	sheetWidth?: number;
}

export interface RunOptions {
	config: Config;
	/** Keep browsers and servers between runs (the daemon passes its own). */
	runtime?: Runtime;
	log?: (message: string) => void;
	signal?: AbortSignal;
	/** Caps shared with other runs (the daemon passes the machine's). */
	pools?: RunContext['pools'];
	/** Called as each picture finishes: for progress. */
	onCell?: (result: CellResult, done: number, total: number) => void;
}

export function stateDir(config: Config): string {
	return resolve(config.root ?? process.cwd(), config.out ?? '.facetshot');
}

function newRunId(): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${randomBytes(2).toString('hex')}`;
}

/** Runs, newest first. */
export function listRuns(config: Config): string[] {
	const runs = join(stateDir(config), 'runs');
	if (!existsSync(runs)) return [];
	return readdirSync(runs)
		.filter((name) => /^\d{8}-\d{6}-[0-9a-f]{4}$/.test(name))
		.sort()
		.reverse();
}

export function readManifest(folder: string): Manifest | undefined {
	const file = join(folder, 'manifest.json');
	return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Manifest) : undefined;
}

/** Where to find the pictures to compare with. */
function comparisonFolder(config: Config, against: string, current: string): string | undefined {
	const state = stateDir(config);
	if (against === 'previous') {
		const run = listRuns(config).find((id) => join(state, 'runs', id) !== current);
		return run ? join(state, 'runs', run) : undefined;
	}
	const baseline = join(state, 'baselines', against);
	if (existsSync(baseline)) return baseline;
	const run = join(state, 'runs', against);
	if (existsSync(run)) return run;
	const folder = resolve(config.root ?? '.', against);
	if (existsSync(folder)) return folder;
	throw new UsageError(
		`Nothing to compare with called "${against}".`,
		'Use "previous", a baseline name (facetshot baseline save <name>), a run id, or a folder.'
	);
}

const DEFAULT_CHECKS = ['console', 'network'];
/** Every check but accessibility, which needs axe-core and is slow: `all` adds it for `facetshot check`. */
const ALL: string[] = ALL_CHECKS.filter((name) => name !== 'a11y');

export async function run(request: RunRequest, options: RunOptions): Promise<Manifest> {
	const started = Date.now();
	const config = options.config;
	const root = config.root ?? process.cwd();
	const log = options.log ?? (() => {});
	const controller = new AbortController();
	const abort = () => controller.abort(options.signal?.reason);
	options.signal?.addEventListener('abort', abort, { once: true });
	const atEnd: (() => Promise<void>)[] = [];
	const state = stateDir(config);
	const targets = request.steps?.length
		? request.targets.map((target) =>
				inlineFlow(config.aliases?.[target] ?? target, request.steps!, state)
			)
		: request.targets;
	const planned = plan({ ...request, targets }, config);
	const runId = newRunId();
	const runDir = request.out ? resolve(root, request.out) : join(state, 'runs', runId);
	if (request.clean && existsSync(runDir)) rmSync(runDir, { recursive: true, force: true });
	mkdirSync(runDir, { recursive: true });

	const ownsRuntime = !options.runtime;
	const runtime = options.runtime ?? new Runtime();
	const limits = config.limits ?? {};
	const lockDir = expandHome(limits.lockDir ?? join(homeFolder(), 'locks'));
	const checks = request.checks?.includes('all')
		? request.checkOnly
			? [...ALL, 'a11y']
			: ALL
		: (request.checks ?? (request.checkOnly ? ALL : (config.checks ?? DEFAULT_CHECKS)));

	const results: CellResult[] = [];
	const errors: string[] = [...planned.unmatched];
	const ctx: RunContext = {
		config,
		root,
		stateDir: state,
		runId,
		runDir,
		values: {},
		services: {},
		checks,
		images: !request.checkOnly,
		runtime,
		pools: options.pools ?? {
			web: new Pool(limits.webPages ?? 4, limits.maxLoad ?? 3),
			simulators: new Pool(limits.simulators ?? 2, limits.maxLoad ?? 3)
		},
		locks: {
			build: join(lockDir, limits.lockNames?.build ?? 'build.lock'),
			macWindow: join(lockDir, limits.lockNames?.macWindow ?? 'mac-window.lock')
		},
		log,
		signal: controller.signal,
		atEnd: (close) => void atEnd.push(close)
	};

	let prepareMs: number;
	try {
		// Services first: the app's server, an API. Their URLs become `{services.<name>.url}`.
		// One after another: a service's command may name an earlier one's `{services.<name>.url}`.
		for (const [name, service] of Object.entries(config.services ?? {})) {
			const running = await runtime.service(`${root}\u0000service:${name}`, () =>
				ensureService(name, service, ctx)
			);
			ctx.services[name] = { url: running.url };
			ctx.values[`services.${name}.url`] = running.url;
		}
		// Then test data, whose ids fill `{placeholders}` in the targets.
		Object.assign(ctx.values, await prepareFixtures(ctx));

		// Each cell goes to the first driver that takes it.
		const drivers = createDrivers();
		const assigned = new Map<Driver, Cell[]>();
		for (const cell of planned.cells) {
			const driver = drivers.find((each) => each.handles(cell, config));
			if (!driver) {
				results.push(
					failed(
						cell,
						`Nothing here can show a ${cell.target.kind} target on a ${cell.device.platform} device.`
					)
				);
			} else if (assigned.has(driver)) assigned.get(driver)!.push(cell);
			else assigned.set(driver, [cell]);
		}
		const prepared = await Promise.allSettled(
			[...assigned].map(async ([driver, cells]) => {
				await driver.prepare(cells, ctx);
				return driver;
			})
		);
		prepareMs = Date.now() - started;
		// Patterns become the pictures they stand for, now that the drivers know what exists.
		for (const [index, [driver, cells]] of [...assigned].entries()) {
			if (prepared[index].status === 'fulfilled' && driver.expand)
				assigned.set(driver, driver.expand(cells, ctx));
		}
		// The sheets' browser starts while the pictures are taken, not after: on runs that shoot no Chromium pages (an
		// app, WebKit) its launch would otherwise come on top of the run.
		const sheetBrowser = request.checkOnly ? undefined : runtime.browser('chromium');
		sheetBrowser?.catch(() => {});
		let done = 0;
		const total =
			[...assigned.values()].reduce((sum, cells) => sum + cells.length, 0) + results.length;
		const report = (result: CellResult) => {
			results.push(result);
			done += 1;
			options.onCell?.(result, done, total);
		};
		await Promise.all(
			[...assigned].map(async ([driver, cells], index) => {
				const outcome = prepared[index];
				if (outcome.status === 'rejected') {
					const reason = explain(outcome.reason);
					errors.push(`${driver.name}: ${reason}`);
					for (const cell of cells)
						report(failed(cell, `Couldn't get ${driver.name} ready (see errors above).`));
					return;
				}
				try {
					await driver.shoot(cells, ctx, report);
				} catch (error) {
					errors.push(`${driver.name}: ${explain(error)}`);
					const reported = new Set(
						results.map((result) => `${result.target}|${result.device}|${result.variant}`)
					);
					for (const cell of cells) {
						if (
							!reported.has(
								`${cell.sceneId ?? cell.target.raw}|${cell.device.name}|${cell.variant.name}`
							)
						) {
							report(failed(cell, explain(error)));
						}
					}
				}
			})
		);

		// Compare with an earlier run.
		if (request.diff && !request.checkOnly) {
			const against = comparisonFolder(config, request.diff, runDir);
			for (const result of results) {
				if (result.status !== 'ok' || !result.image) continue;
				if (!against) {
					result.diff = { against: request.diff, ratio: 1 };
					(result.notes ??= []).push('nothing earlier to compare with');
					continue;
				}
				const outcome = diffImages(
					join(runDir, result.image),
					join(against, result.image),
					runDir,
					result.image
				);
				result.diff = { against: against, ratio: outcome.ratio, image: outcome.image };
				if (outcome.note) (result.notes ??= []).push(outcome.note);
			}
		}

		// One sheet per screen.
		const screens = [...new Set(results.map((result) => result.screen))].sort();
		const deviceNames = planned.devices.map((device) => device.name);
		const variantNames = planned.variants.map((variant) => variant.name);
		const browser = results.some((r) => r.image) ? await sheetBrowser : undefined;
		const sheets: Manifest['screens'] = screens.map((screen) => ({ screen }));
		await ctx.pools.web.each(sheets, async (entry) => {
			const cells = results.filter((result) => result.screen === entry.screen);
			if (request.diff) entry.changed = cells.some((cell) => (cell.diff?.ratio ?? 0) > 0);
			if (browser && cells.some((cell) => cell.image)) {
				entry.sheet = await drawSheet(
					browser,
					runDir,
					entry.screen,
					cells,
					deviceNames,
					variantNames,
					{ width: request.sheetWidth }
				);
			}
		});

		const order = (r: CellResult) =>
			`${r.screen}|${deviceNames.indexOf(r.device)}|${variantNames.indexOf(r.variant)}`;
		results.sort((a, b) => order(a).localeCompare(order(b)));
		const manifest: Manifest = {
			version: 1,
			runId,
			startedAt: new Date(started).toISOString(),
			ms: Date.now() - started,
			prepareMs,
			root,
			out: runDir,
			devices: deviceNames,
			variants: variantNames,
			screens: sheets,
			cells: results,
			errors,
			counts: {
				ok: results.filter((r) => r.status === 'ok').length,
				failed: results.filter((r) => r.status === 'failed').length,
				skipped: results.filter((r) => r.status === 'skipped').length,
				findings: results.reduce(
					(sum, r) => sum + (r.findings?.filter((f) => f.severity !== 'info').length ?? 0),
					0
				),
				changed: request.diff ? sheets.filter((s) => s.changed).length : undefined
			}
		};
		writeManifest(manifest);
		if (!request.out) pointLatest(state, runDir);
		pruneRuns(config);
		return manifest;
	} finally {
		options.signal?.removeEventListener('abort', abort);
		// What this run opened for itself closes now, each step bounded so a stuck one can't hold the run.
		for (const close of atEnd.reverse()) await within(close(), 10_000);
		// Test data, servers and browsers this run opened go with the runtime (the daemon keeps its own open).
		if (ownsRuntime) await runtime.close();
	}
}

function pointLatest(state: string, runDir: string): void {
	const link = join(state, 'latest');
	try {
		if (existsSync(link)) unlinkSync(link);
		symlinkSync(runDir, link);
	} catch {
		// A file system without symlinks just doesn't get the shortcut.
	}
}

/** Keeps the last 20 runs; baselines are kept until removed. */
function pruneRuns(config: Config, keep = 20): void {
	const state = stateDir(config);
	for (const id of listRuns(config).slice(keep))
		rmSync(join(state, 'runs', id), { recursive: true, force: true });
}
