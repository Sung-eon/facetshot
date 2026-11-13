/**
 * App screens in the iOS simulator: the real app, built once, installed once, launched once per device, and moved
 * from screen to screen by deep link while the simulator's own settings switch the variants (appearance, text size,
 * contrast) under it, live.
 *
 * - Simulators are facetshot's own (`facetshot-<model>`); a person's are never used. Devices get a simulator each when
 *   they fit in the simulator limit; otherwise devices of one model share one, one after the other.
 * - Opening a deep link without the system's "Open in …?" question, turning the device, and pressing and typing in
 *   a flow are things `simctl` can't do. A small UI test (`FacetshotRunner/`) does them: built once per change of
 *   its sources into `~/.facetshot/cache/runner/`, started with `xcodebuild test-without-building` once per
 *   simulator per run, and fed one command at a time through files.
 * - A screen is ready when the app writes FACETSHOT_READY_FILE (`apple.readyFile`); one screenshot follows its last
 *   frame (Reduce Motion is on). Without the file, two screenshots 250 ms apart being the same decide (up to 8 s).
 * - `split` devices (an iPad's half) can't be made from outside either: the app is launched with
 *   FACETSHOT_SPLIT_WIDTH=<points> and is expected to draw itself that wide.
 */
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { Cell, CellResult, Config, Device, Variant } from '../types.ts';
import { homeFolder } from '../config.ts';
import { listFiles } from '../engine/cache.ts';
import { withLock } from '../engine/lock.ts';
import { exec, launch, runToEnd, sleep, stopGroup, tail, within } from '../engine/procs.ts';
import { EnvironmentError, firstLine, UsageError } from '../errors.ts';
import { loadFlow, shotNames, type Step } from '../flows.ts';
import { matcher, parseNodes } from './mac-ui.ts';
import {
	appEnv,
	bundleExecutable,
	deepLink,
	obtainApp,
	selectorLabel,
	settle,
	waitForFile,
	type BuiltApp
} from './apple.ts';
import {
	failed,
	failRest,
	fillAddress,
	keepLog,
	reporter,
	result,
	stopped,
	unreadable,
	notApplied,
	type Driver,
	type RunContext
} from './driver.ts';
import { imagePath, pngSize } from './page.ts';
import { LogBook, recordSystemLog } from '../logs.ts';
import { PNG } from 'pngjs';
import { boot, CONTENT_SIZE, ensureSimulator, simctl, simulatorName } from './simctl.ts';

/** After the app's ready word, how long its last transition may take (with Reduce Motion it's a cross-fade). */
const SETTLE_AFTER_READY = 400;

const RUNNER_DIR = join(import.meta.dirname, '..', '..', 'FacetshotRunner');
const READY_TIMEOUT = 15_000;

/** The UI test that turns and presses, as a running process taking commands. */
class RunnerSession {
	private next = 1;
	private constructor(
		private readonly folder: string,
		private readonly child: ChildProcess,
		private readonly log: string
	) {}

	static async start(
		xctestrun: string,
		udid: string,
		bundleId: string,
		ctx: RunContext
	): Promise<RunnerSession> {
		const folder = join(ctx.stateDir, 'runner', `${udid}-${process.pid}-${Date.now()}`);
		rmSync(folder, { recursive: true, force: true });
		mkdirSync(folder, { recursive: true });
		const log = join(ctx.stateDir, 'logs', `runner-${udid}.log`);
		ctx.log('Starting the simulator runner (turns the device, presses for flows)…');
		const child = launch(
			{
				cmd:
					`xcodebuild test-without-building -xctestrun ${JSON.stringify(xctestrun)} -destination ${JSON.stringify(`id=${udid}`)} ` +
					// Its result bundle goes in the session's folder, removed when the session stops; left to itself,
					// xcodebuild files every session in a DerivedData folder of its own that nothing ever removes.
					`-derivedDataPath ${JSON.stringify(join(ctx.stateDir, 'runner', 'derived'))} ` +
					`-resultBundlePath ${JSON.stringify(join(folder, 'result.xcresult'))} ` +
					`-only-testing:FacetshotRunner/FacetshotRunner/testServe`,
				env: { TEST_RUNNER_FACETSHOT_RUNNER_DIR: folder, TEST_RUNNER_FACETSHOT_BUNDLE_ID: bundleId }
			},
			{ root: ctx.root, values: {}, logFile: log }
		);
		let exited: number | null | undefined;
		child.on('exit', (code) => (exited = code));
		const until = Date.now() + 180_000;
		while (!existsSync(join(folder, 'started'))) {
			if (exited !== undefined || Date.now() > until) {
				await stopGroup(child.pid);
				throw new EnvironmentError(
					`The simulator runner didn't start${exited !== undefined ? ` (exit ${exited})` : ' within 3 minutes'}. The end of its log (${log}):\n${tail(log, 8)}`,
					'Delete ~/.facetshot/cache/runner to rebuild it, and check that Xcode can run UI tests on this simulator.'
				);
			}
			ctx.signal.throwIfAborted();
			await sleep(200);
		}
		return new RunnerSession(folder, child, log);
	}

	/** One command; throws with the runner's reason if it couldn't do it. Returns what it wrote, if anything. */
	async send(words: string[], timeout = 60_000): Promise<string | undefined> {
		const n = this.next++;
		const command = join(this.folder, `${n}.cmd`);
		writeFileSync(
			`${command}.tmp`,
			words.map((word) => word.replace(/[\t\n]/g, ' ')).join('\t') + '\n'
		);
		renameSync(`${command}.tmp`, command);
		const answer = join(this.folder, `${n}.out`);
		if (!(await waitForFile(answer, timeout))) {
			throw new Error(
				`The simulator runner didn't answer "${words.join(' ')}" within ${timeout / 1000} s (log: ${this.log}).`
			);
		}
		await sleep(20);
		const [status, why] = readFileSync(answer, 'utf8').trim().split('\t');
		if (status !== 'ok') throw new Error(why ?? status);
		const data = join(this.folder, `${n}.data`);
		return existsSync(data) ? readFileSync(data, 'utf8') : undefined;
	}

	async stop(): Promise<void> {
		await this.send(['quit'], 10_000).catch(() => {});
		const exited = await within(
			new Promise((done) =>
				this.child.exitCode !== null ? done(true) : this.child.once('exit', done)
			),
			20_000
		);
		if (!exited) await stopGroup(this.child.pid);
		rmSync(this.folder, { recursive: true, force: true });
	}
}

/** The runner's test bundle, built once per change of its sources and shared by every checkout on this machine. */
async function runnerBuild(ctx: RunContext): Promise<string> {
	const hash = createHash('sha256');
	for (const path of listFiles(RUNNER_DIR))
		hash.update(`${path.slice(RUNNER_DIR.length)}\n`).update(readFileSync(path));
	const derived = join(homeFolder(), 'cache', 'runner', hash.digest('hex').slice(0, 16));
	const find = () => {
		const products = join(derived, 'Build', 'Products');
		const file = existsSync(products)
			? readdirSync(products).find((name) => name.endsWith('.xctestrun'))
			: undefined;
		return file ? join(products, file) : undefined;
	};
	const ready = find();
	if (ready) return ready;
	return withLock(
		ctx.locks.build,
		'facetshot build of the simulator runner',
		async () => {
			// Someone else may have built it while this waited.
			const built = find();
			if (built) return built;
			ctx.log('Building the simulator runner (once per version)…');
			await runToEnd(
				{
					cmd:
						`xcodebuild build-for-testing -quiet -project FacetshotRunner.xcodeproj -scheme FacetshotRunner ` +
						`-destination 'generic/platform=iOS Simulator' -derivedDataPath ${JSON.stringify(derived)} ` +
						`-jobs 4 ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO`,
					cwd: RUNNER_DIR
				},
				{
					root: RUNNER_DIR,
					values: {},
					logFile: join(ctx.stateDir, 'logs', 'build-runner.log'),
					what: 'The simulator runner build',
					signal: ctx.signal
				}
			);
			const made = find();
			if (!made)
				throw new EnvironmentError(
					`The runner built, but no .xctestrun is in ${derived}.`,
					'Delete that folder and run again.'
				);
			return made;
		},
		{ onWait: ctx.log, signal: ctx.signal, poll: 5000 }
	);
}

/** Keeps the left `width` pixels of a PNG (sips only crops around the centre). */
function cropLeft(file: string, width: number): { width: number; height: number } {
	const source = PNG.sync.read(readFileSync(file));
	const out = new PNG({ width, height: source.height });
	PNG.bitblt(source, out, 0, 0, width, source.height, 0, 0);
	writeFileSync(file, PNG.sync.write(out));
	return { width, height: source.height };
}

/** One simulator at work: what is installed, launched, and set on it. */
interface Simulator {
	udid: string;
	name: string;
	readyFile: string;
	runner?: RunnerSession;
	/** What the app writes to the system log inside the simulator, while facetshot works on it. */
	log?: { book: LogBook; stop: () => void };
	orientation: 'portrait' | 'landscape';
	settings: Map<string, string>;
}

interface Lane {
	model: string;
	/** 0 for the model's first simulator, 1 for its second… */
	index: number;
	cells: Cell[];
}

/**
 * Which simulator takes which pictures: a lane per device when they all fit in the simulator limit, otherwise a lane
 * per model (an iPad upright and sideways on one simulator, turned once). Heaviest
 * lanes first, so the longest work starts first.
 */
function lanes(cells: Cell[], slots: number): Lane[] {
	const model = (cell: Cell) => cell.device.model ?? 'iPhone 17 Pro Max';
	const devices = [...new Set(cells.map((cell) => cell.device.name))];
	// Only as many lanes as may run at once: a lane beyond that shuts its simulator down and boots the next, and two
	// simulators of one model running together are slower per screenshot than one doing both (measured on 10 cores).
	const perDevice = devices.length <= slots;
	const result: Lane[] = [];
	const seen = new Map<string, number>();
	for (const key of perDevice ? devices : [...new Set(cells.map(model))]) {
		const mine = cells.filter((cell) => (perDevice ? cell.device.name : model(cell)) === key);
		const m = model(mine[0]);
		const index = seen.get(m) ?? 0;
		seen.set(m, index + 1);
		result.push({ model: m, index, cells: mine });
	}
	// Bigger screens take longer per picture: weigh by pixels, so the slowest lanes don't wait for a free slot.
	const weight = (lane: Lane) =>
		lane.cells.length * lane.cells[0].device.width * lane.cells[0].device.height;
	return result.sort((a, b) => weight(b) - weight(a));
}

export class IosSimulatorDriver implements Driver {
	private lanes: Lane[] = [];
	readonly name = 'iOS simulator';
	private app: BuiltApp | undefined;
	private runner: string | undefined;

	handles(cell: Cell, config: Config): boolean {
		return (
			(cell.target.kind === 'app' || cell.target.kind === 'flow') &&
			cell.device.platform === 'ios' &&
			!!config.apple
		);
	}

	async prepare(cells: Cell[], ctx: RunContext): Promise<void> {
		const apple = ctx.config.apple;
		if (!apple)
			throw new UsageError('app: targets on iOS need an `apple` section in facetshot.config.ts.');
		if (process.platform !== 'darwin')
			throw new EnvironmentError(
				'iOS simulators run only on a Mac.',
				'Shoot web or window devices here, or run on a Mac.'
			);
		this.lanes = lanes(cells, ctx.pools.simulators.size);
		// The app, the runner and the simulators are independent: get them all at once.
		const [app, runner] = await Promise.all([
			obtainApp('apple.ios', apple.ios, ctx),
			runnerBuild(ctx),
			...this.lanes.map((lane) => ensureSimulator(lane.model, ctx, lane.index))
		]);
		this.app = app as BuiltApp;
		this.runner = runner as string;
	}

	async shoot(cells: Cell[], ctx: RunContext, report: (result: CellResult) => void): Promise<void> {
		const all = this.lanes.length ? this.lanes : lanes(cells, ctx.pools.simulators.size);
		// More lanes than may be booted at once: each is shut down when its screenshots are done, to make room.
		const crowded = all.length > ctx.pools.simulators.size;
		await ctx.pools.simulators.each(
			all,
			async ({ model, index, cells: group }) => {
				const name = simulatorName(model, index);
				try {
					// One run at a time on a simulator, across checkouts and agents: it is facetshot's, not this run's.
					await withLock(
						join(homeFolder(), 'locks', `${name}.lock`),
						`facetshot on ${name} in ${ctx.root}`,
						() => this.onSimulator(model, index, group, crowded, ctx, report),
						{
							onWait: ctx.log,
							signal: ctx.signal,
							poll: 2000
						}
					);
				} catch (error) {
					// Only what comes before the first screenshot (boot, install) gets here; a device's own failure is reported per device.
					for (const cell of group) report(failed(cell, firstLine(error)));
				}
			},
			ctx.signal
		);
	}

	private async onSimulator(
		model: string,
		lane: number,
		cells: Cell[],
		crowded: boolean,
		ctx: RunContext,
		report: (result: CellResult) => void
	): Promise<void> {
		const apple = ctx.config.apple!;
		const app = this.app!;
		const udid = await ensureSimulator(model, ctx, lane);
		const name = simulatorName(model, lane);
		await boot(udid, ctx);
		// facetshot's simulators are its own whoever booted them (an earlier helper, a killed run): this runtime shuts
		// down every one it used, once, so none is left running.
		const closing = `ios-close:${udid}`;
		if (!crowded && !ctx.runtime.memo.has(closing)) {
			ctx.runtime.memo.set(closing, true);
			ctx.runtime.onClose(`simulator ${name}`, () => simctl('shutdown', udid).then(() => {}));
		}
		await simctl(
			'status_bar',
			udid,
			'override',
			'--time',
			'9:41',
			'--dataNetwork',
			'wifi',
			'--wifiMode',
			'active',
			'--wifiBars',
			'3',
			'--cellularMode',
			'active',
			'--cellularBars',
			'4',
			'--batteryState',
			'charged',
			'--batteryLevel',
			'100'
		).catch(() => {});
		// Reduce Motion, as the web gets prefers-reduced-motion: transitions become short fades, so one screenshot taken just
		// after the app says it's ready is the finished screen. Read by apps at launch, which comes after this.
		await simctl(
			'spawn',
			udid,
			'defaults',
			'write',
			'com.apple.Accessibility',
			'ReduceMotionEnabled',
			'-bool',
			'true'
		).catch(() => {});
		// The keyboard's first-run card ("slide to type") would cover the first screenshot with a keyboard in it.
		await simctl(
			'spawn',
			udid,
			'defaults',
			'write',
			'com.apple.keyboard.preferences',
			'DidShowContinuousPathIntroduction',
			'-bool',
			'true'
		).catch(() => {});
		await this.install(udid, app, apple.bundleId, ctx);

		const sim: Simulator = {
			udid,
			name,
			readyFile: join(ctx.stateDir, 'ready', `${udid}.ready`),
			orientation: 'portrait',
			settings: new Map()
		};
		mkdirSync(dirname(sim.readyFile), { recursive: true });
		// Upright devices first, then on its side, then the halves: each turn and each relaunch happens once.
		const order = (device: Device) =>
			device.split ? 2 : device.orientation === 'landscape' ? 1 : 0;
		const devices = [
			...new Map(cells.map((cell) => [cell.device.name, cell.device])).values()
		].sort((a, b) => order(a) - order(b));
		const tell = reporter(report);
		try {
			for (const device of devices) {
				const mine = cells.filter((cell) => cell.device.name === device.name);
				try {
					await this.onDevice(sim, device, mine, ctx, (result, cell) => tell.report(cell, result));
				} catch (error) {
					tell.failRest(mine, error);
				}
			}
		} finally {
			sim.log?.stop();
			sim.log = undefined;
			if (sim.runner) {
				// Left upright for whoever comes next.
				if (sim.orientation !== 'portrait')
					await sim.runner.send(['orient', 'portrait']).catch(() => {});
				await sim.runner.stop();
			}
			if (crowded) {
				ctx.runtime.memo.delete(`ios-launch:${udid}`);
				await simctl('shutdown', udid).catch(() => {});
			}
		}
	}

	/** Installs the app when this simulator doesn't have this build of it yet. */
	private async install(
		udid: string,
		app: BuiltApp,
		bundleId: string,
		ctx: RunContext
	): Promise<void> {
		const stamp = join(homeFolder(), 'sims', `${udid}.json`);
		let installed: Record<string, string> = {};
		try {
			installed = JSON.parse(readFileSync(stamp, 'utf8'));
		} catch {
			// Nothing recorded yet.
		}
		const there = await simctl('get_app_container', udid, bundleId).then(
			() => true,
			() => false
		);
		if (there && installed[bundleId] === app.key) return;
		ctx.log(`Installing ${bundleId} on ${udid}…`);
		await simctl('install', udid, app.path);
		installed[bundleId] = app.key;
		mkdirSync(dirname(stamp), { recursive: true });
		writeFileSync(stamp, JSON.stringify(installed));
		ctx.runtime.memo.delete(`ios-launch:${udid}`);
	}

	private async onDevice(
		sim: Simulator,
		device: Device,
		cells: Cell[],
		ctx: RunContext,
		report: (result: CellResult, cell: Cell) => void
	): Promise<void> {
		const apple = ctx.config.apple!;
		const wanted = device.orientation === 'landscape' ? 'landscape' : 'portrait';
		sim.runner ??= await RunnerSession.start(this.runner!, sim.udid, apple.bundleId, ctx);
		if (!sim.log) {
			// By process name, so lines from the app's first moments are kept. Swift's print doesn't reach facetshot from
			// a simulator; Logger, os_log and NSLog do.
			const app = this.app!.path;
			const book = new LogBook();
			const stop = recordSystemLog(basename(bundleExecutable(app)), basename(app), book, {
				command: ['xcrun', 'simctl', 'spawn', sim.udid, 'log']
			});
			sim.log = { book, stop };
		}

		// One launch per device: what it is launched with only changes between devices (a half has its own width).
		const env: Record<string, string> = appEnv(apple.env, apple, undefined, ctx.values);
		if (apple.readyFile) env.FACETSHOT_READY_FILE = sim.readyFile;
		// A half's width is the device's own (the screen is the whole iPad, turned as the device says).
		if (device.split) env.FACETSHOT_SPLIT_WIDTH = String(device.width);
		const key = JSON.stringify({ app: this.app!.key, env, args: apple.args ?? [] });
		const memo = `ios-launch:${sim.udid}`;
		if (ctx.runtime.memo.get(memo) !== key) {
			rmSync(sim.readyFile, { force: true });
			// Launched by the runner, so the runner can always reach it (see FacetshotRunner.swift).
			await sim.runner.send(['launch', JSON.stringify({ env, args: apple.args ?? [] })], 120_000);
			ctx.runtime.memo.set(memo, key);
			// The launch's own first screen settles before any address is opened, so its "ready" can't be mistaken for the next one's.
			if (apple.readyFile) await waitForFile(sim.readyFile, READY_TIMEOUT, ctx.signal);
			else await sleep(2000);
		}
		await sim.runner.send(['activate']);
		if (sim.orientation !== wanted) {
			await sim.runner.send(['orient', wanted]);
			sim.orientation = wanted;
			await sleep(800);
		}

		const variants = [...new Map(cells.map((cell) => [cell.variant.name, cell.variant])).values()];
		for (const variant of variants) {
			const notes = await this.applyVariant(sim, variant);
			for (const cell of cells.filter((each) => each.variant.name === variant.name)) {
				if (ctx.signal.aborted) {
					report(stopped(cell), cell);
					continue;
				}
				if (!ctx.images) {
					report(unreadable(cell, 'an app screen'), cell);
					continue;
				}
				await this.shootCell(sim, cell, notes, ctx, (result) => report(result, cell));
			}
		}
	}

	/** Sets the simulator to the variant, only where it changed. Returns notes for what a simulator can't switch. */
	private async applyVariant(sim: Simulator, variant: Variant): Promise<string[]> {
		const set = async (option: string, value: string) => {
			if (sim.settings.get(option) === value) return;
			await simctl('ui', sim.udid, option, value);
			sim.settings.set(option, value);
		};
		await set('appearance', variant.appearance ?? 'light');
		await set('content_size', CONTENT_SIZE[variant.text ?? 'default']);
		await set('increase_contrast', variant.contrast === 'more' ? 'enabled' : 'disabled').catch(
			() => {}
		);
		return notApplied(variant, ['appearance', 'text', ['contrast', 'more']], 'in the simulator');
	}

	private async shootCell(
		sim: Simulator,
		cell: Cell,
		notes: string[],
		ctx: RunContext,
		report: (result: CellResult) => void
	): Promise<void> {
		const apple = ctx.config.apple!;
		const started = Date.now();
		const open = async (address: string) => {
			const filled = fillAddress(cell, address, ctx.values);
			rmSync(sim.readyFile, { force: true });
			// Through the runner: `simctl openurl` stops at the system's "Open in …?" question every time.
			await sim.runner!.send(['open', deepLink(apple, filled)]);
		};
		const picture = async (screen: string) => {
			const out = result(cell, { screen });
			const extra = [...notes];
			let ready: boolean | undefined;
			if (apple.readyFile) {
				ready = await waitForFile(sim.readyFile, READY_TIMEOUT, ctx.signal);
				if (!ready)
					extra.push(
						`The app didn't write its ready file within ${READY_TIMEOUT / 1000} s; shot when the screen stopped changing.`
					);
			} else {
				// Nothing tells when the app has taken the address in: a moment for it to start changing.
				await sleep(500);
			}
			const { file, rel } = imagePath(ctx.runDir, screen, cell.device.name, cell.variant.name);
			const shoot = (to: string) =>
				simctl('io', sim.udid, 'screenshot', '--type=png', to).then(() => {});
			// The app said it is ready, and Reduce Motion is on: one screenshot after the last frame is drawn. Without that
			// word, wait until two screenshots in a row are the same.
			const settled = ready
				? await sleep(SETTLE_AFTER_READY).then(async () => {
						await shoot(file);
						return { stable: true, ms: SETTLE_AFTER_READY };
					})
				: await settle(shoot, file, { cap: 8000, signal: ctx.signal });
			if (!settled.stable)
				extra.push(
					`Still changing after ${(settled.ms / 1000).toFixed(1)} s; this is the last screenshot.`
				);
			let size = pngSize(file);
			// The simulator's framebuffer stays upright; a device on its side is pictured as a person holding it sees it.
			if (cell.device.orientation === 'landscape' && size.width < size.height) {
				await exec('sips', ['-r', '270', file, '--out', file]);
				size = pngSize(file);
			}
			if (cell.device.split) {
				// The app drew itself in the left part of the screen; the screenshot is that part.
				size = cropLeft(file, Math.round(size.width * cell.device.split));
				extra.push(
					`Split View drawn by the app itself at FACETSHOT_SPLIT_WIDTH (the simulator can't open Split View).`
				);
			}
			Object.assign(out, {
				image: rel,
				...size,
				ms: Date.now() - started,
				readyTimedOut: ready === false || !settled.stable ? true : undefined,
				notes: extra.length ? extra : undefined
			});
			if (sim.log) keepLog(ctx, out, sim.log.book, started);
			report(out);
		};

		if (cell.target.kind !== 'flow') {
			try {
				await open(cell.sceneId ?? cell.target.value);
				await picture(cell.screen);
			} catch (error) {
				report(failed(cell, firstLine(error), Date.now() - started));
			}
			return;
		}

		const flow = loadFlow(cell.target.value, ctx.root);
		const names = shotNames(flow);
		let shots = 0;
		try {
			await open(flow.start);
			for (const [index, step] of flow.steps.entries()) {
				try {
					if ('shot' in step) {
						shots += 1;
						await picture(`${cell.screen}.${step.shot}`);
					} else {
						await this.step(sim, step, open);
					}
				} catch (error) {
					throw new Error(
						`step ${index + 1} of ${flow.name} (${JSON.stringify(step)}) didn't work: ${firstLine(error)}`,
						{ cause: error }
					);
				}
			}
			if (!flow.steps.some((step) => 'shot' in step)) {
				shots += 1;
				await picture(`${cell.screen}.end`);
			}
		} catch (error) {
			failRest(cell, names, shots, error, started, report);
		}
	}

	/** One flow step that isn't a screenshot. */
	private async step(
		sim: Simulator,
		step: Step,
		open: (address: string) => Promise<void>
	): Promise<void> {
		if ('goto' in step) return open(step.goto);
		const runner = sim.runner;
		if (!runner) throw new Error("this step needs the XCUITest runner, which isn't running");
		const send = async (...words: string[]) => void (await runner.send(words));
		/** Where a target is: `@x,y` as it is, or the middle of the first element that matches it. */
		const point = async (target: string): Promise<string[]> => {
			const at = /^@\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)$/.exec(target.trim());
			if (at) return [at[1], at[2]];
			// role=… is matched as everywhere; anything else (a label, #id, text=…) the way the runner finds a label.
			const label = selectorLabel(target);
			const match = /^role=/.test(target.trim())
				? matcher(target)
				: (node: { name: string; value?: string }) => node.name === label || node.value === label;
			const deadline = Date.now() + 10_000;
			for (;;) {
				const node = parseNodes((await runner.send(['tree'])) ?? '').find(match);
				if (node?.width)
					return [String(node.x! + node.width / 2), String(node.y! + node.height! / 2)];
				if (Date.now() > deadline) throw new Error(`Nothing on screen matches ${target}.`);
				await sleep(250);
			}
		};
		/** Labels and ids go straight to the runner, which finds them itself; points and roles through the tree. */
		const byLabel = (target: string) => !/^(@|role=)/.test(target.trim());
		const press = async (target: string) =>
			byLabel(target)
				? send('tap', selectorLabel(target))
				: send('press', ...(await point(target)));
		if ('click' in step) return press(step.click);
		if ('tap' in step) return press(step.tap);
		// A context menu on iOS is a long press: the right-click of a flow written for the web or a Mac does the same.
		if ('longpress' in step) return send('longpress', ...(await point(step.longpress)));
		if ('rightclick' in step) return send('longpress', ...(await point(step.rightclick)));
		if ('drag' in step) return send('drag', ...(await point(step.drag)), ...(await point(step.to)));
		if ('fill' in step) {
			if (byLabel(step.fill)) return send('fill', selectorLabel(step.fill), step.with);
			await send('press', ...(await point(step.fill)));
			return send('type', step.with);
		}
		if ('type' in step) return send('type', step.type);
		if ('wait' in step)
			return byLabel(step.wait)
				? send('wait', selectorLabel(step.wait), '15')
				: void (await point(step.wait));
		if ('gone' in step) return send('gone', selectorLabel(step.gone), '15');
		if ('scroll' in step && typeof step.scroll === 'number')
			return send('swipe', step.scroll > 0 ? 'up' : 'down');
		throw new Error(
			`${Object.keys(step)[0]} isn't something a simulator can do; it takes taps, long presses, drags, typing, waits and swipes.`
		);
	}
}
