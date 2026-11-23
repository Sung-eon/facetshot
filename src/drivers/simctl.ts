/**
 * The iOS simulator, through `xcrun simctl`. facetshot only ever uses simulators it made itself (named
 * `facetshot-<model>`), so the ones a person keeps for their own work are never booted, changed or erased.
 */
import { join } from 'node:path';
import { homeFolder } from '../config.ts';
import { tryLock, withLock } from '../engine/lock.ts';
import { exec } from '../engine/procs.ts';
import { memoryPressure } from '../engine/scheduler.ts';
import { EnvironmentError } from '../errors.ts';
import type { RunContext } from './driver.ts';

export async function simctl(...args: string[]): Promise<string> {
	try {
		const { stdout } = await exec('xcrun', ['simctl', ...args], { maxBuffer: 64 * 1024 * 1024 });
		return stdout;
	} catch (error) {
		const stderr = (error as { stderr?: string }).stderr?.trim();
		throw new Error(`simctl ${args[0]} failed: ${stderr || (error as Error).message}`, {
			cause: error
		});
	}
}

interface SimDevice {
	udid: string;
	name: string;
	state: string;
	isAvailable: boolean;
	deviceTypeIdentifier?: string;
}

export async function devices(): Promise<(SimDevice & { runtime: string })[]> {
	const list = JSON.parse(await simctl('list', '-j', 'devices')) as {
		devices: Record<string, SimDevice[]>;
	};
	return Object.entries(list.devices).flatMap(([runtime, items]) =>
		items.map((item) => ({ ...item, runtime }))
	);
}

/** facetshot's simulator for a model; a second one of the same model (`lane` 1, 2…) gets a number. */
export const simulatorName = (model: string, lane = 0) =>
	`facetshot-${model
		.replace(/[^\w]+/g, '-')
		.replace(/-+$/, '')
		.toLowerCase()}${lane ? `-${lane + 1}` : ''}`;

/**
 * The UDID of facetshot's own simulator for a model, made from the newest iOS runtime if it doesn't exist yet. Falls
 * back to the newest model of the same family when this machine has no such device type.
 */
export async function ensureSimulator(
	model: string,
	ctx: Pick<RunContext, 'log'>,
	lane = 0
): Promise<string> {
	const name = simulatorName(model, lane);
	const existing = (await devices()).find((device) => device.name === name && device.isAvailable);
	if (existing) return existing.udid;
	const types = (
		JSON.parse(await simctl('list', '-j', 'devicetypes')) as {
			devicetypes: { name: string; identifier: string }[];
		}
	).devicetypes;
	const family = model.startsWith('iPad') ? 'iPad' : 'iPhone';
	const type =
		types.find((each) => each.name === model) ??
		types.filter((each) => each.name.startsWith(family)).at(-1);
	if (!type)
		throw new EnvironmentError(
			`This Mac has no ${model} simulator.`,
			'Install an iOS simulator runtime in Xcode → Settings → Components.'
		);
	const runtimes = (
		JSON.parse(await simctl('list', '-j', 'runtimes')) as {
			runtimes: {
				identifier: string;
				name: string;
				isAvailable: boolean;
				supportedDeviceTypes?: { identifier: string }[];
			}[];
		}
	).runtimes.filter((each) => each.isAvailable && each.name.startsWith('iOS'));
	// The newest runtime that can run this model: a beta runtime made for one new device can't run the rest.
	const runtime =
		runtimes
			.filter((each) =>
				each.supportedDeviceTypes?.some((supported) => supported.identifier === type.identifier)
			)
			.at(-1) ?? runtimes.at(-1);
	if (!runtime)
		throw new EnvironmentError(
			'This Mac has no iOS simulator runtime.',
			'Install one in Xcode → Settings → Components.'
		);
	if (type.name !== model) ctx.log(`No ${model} simulator here; using ${type.name}.`);
	ctx.log(`Making simulator ${name} (${type.name}, ${runtime.name})…`);
	return (await simctl('create', name, type.identifier, runtime.identifier)).trim();
}

/** facetshot's simulators on this machine. */
export async function ownSimulators(): Promise<(SimDevice & { runtime: string })[]> {
	return (await devices()).filter((device) => device.name.startsWith('facetshot-'));
}

export async function state(udid: string): Promise<string | undefined> {
	return (await devices()).find((device) => device.udid === udid)?.state;
}

/** Boots the simulator if it isn't, and waits until it can take an app. True if this call booted it. */
export async function boot(udid: string, ctx: Pick<RunContext, 'log'>): Promise<boolean> {
	const was = await state(udid);
	if (was !== 'Booted') {
		ctx.log(`Booting ${udid}…`);
		try {
			await simctl('boot', udid);
		} catch (error) {
			// Booted in the meantime by another run: that's fine.
			if (!/current state: Booted/i.test((error as Error).message)) throw error;
		}
	}
	await simctl('bootstatus', udid, '-b');
	return was !== 'Booted';
}

/**
 * How long a simulator stays booted with nothing using it. A booted iOS simulator holds 10 GB or more (its home screen,
 * widgets and system apps run too), so it goes soon after its last screenshot; the next run boots it again, which takes
 * seconds, not minutes.
 */
export const SIMULATOR_IDLE_MS = Number(process.env.FACETSHOT_SIMULATOR_IDLE_MINUTES ?? 3) * 60_000;

/** The simulators this process has booted or used: how many lanes work on each now, and its pending shutdown. */
const inUse = new Map<string, { users: number; timer?: ReturnType<typeof setTimeout> }>();

/** One user of a simulator at a time, across runs, checkouts and agents: it is facetshot's, not one run's. */
const simulatorLock = (udid: string) => join(homeFolder(), 'locks', `simulator-${udid}.lock`);

/** Shuts a simulator down unless someone is working on it (its lock is held); one already shut down is fine. */
async function shutdownIfFree(udid: string): Promise<boolean> {
	const release = tryLock(simulatorLock(udid), 'facetshot shutting down an idle simulator');
	if (!release) return false;
	try {
		await shutdown(udid);
		return true;
	} finally {
		release();
	}
}

/** Shuts a simulator down; one already shut down is fine. */
export async function shutdown(udid: string): Promise<void> {
	const held = inUse.get(udid);
	if (held?.timer) clearTimeout(held.timer);
	if (!held?.users) inUse.delete(udid);
	await simctl('shutdown', udid).catch(() => {});
}

/**
 * Makes room before a simulator boots while memory is short: facetshot's own booted simulators that nothing uses
 * (left idle by this process, or by another) are shut down first.
 */
async function makeRoom(except: string, ctx: Pick<RunContext, 'log'>): Promise<void> {
	if (memoryPressure() === 'normal') return;
	for (const device of await ownSimulators()) {
		if (device.state !== 'Booted' || device.udid === except) continue;
		if (await shutdownIfFree(device.udid))
			ctx.log(`Memory is short: shut down ${device.name}, which nothing was using.`);
	}
}

/**
 * Every use of one of facetshot's simulators goes through here. It waits for the simulator's lock, boots it, runs
 * `work`, and then shuts it down once nothing has used it for SIMULATOR_IDLE_MS, when the runtime closes, or right
 * after `work` with `shutDownAfter` (more lanes than may be booted at once).
 */
export async function useSimulator<T>(
	udid: string,
	ctx: Pick<RunContext, 'log' | 'runtime' | 'root' | 'signal'>,
	work: () => Promise<T>,
	options: { name?: string; shutDownAfter?: boolean } = {}
): Promise<T> {
	const name = options.name ?? udid;
	return withLock(
		simulatorLock(udid),
		`facetshot on ${name} in ${ctx.root}`,
		async () => {
			const held = inUse.get(udid) ?? { users: 0 };
			if (held.timer) clearTimeout(held.timer);
			held.timer = undefined;
			held.users += 1;
			inUse.set(udid, held);
			// Whoever booted it (an earlier helper, a killed run), the runtime that used it shuts it down when it closes.
			const closing = `simulator-close:${udid}`;
			if (!ctx.runtime.memo.has(closing)) {
				ctx.runtime.memo.set(closing, true);
				ctx.runtime.onClose(`simulator ${name}`, () => shutdownIfFree(udid).then(() => {}));
			}
			try {
				await makeRoom(udid, ctx);
				await boot(udid, ctx);
				return await work();
			} finally {
				held.users -= 1;
				if (held.users === 0) {
					if (options.shutDownAfter) await shutdown(udid);
					else {
						held.timer = setTimeout(() => void shutdownIfFree(udid), SIMULATOR_IDLE_MS);
						// A run in its own process ends without waiting for this; its runtime's close shuts it down.
						held.timer.unref?.();
					}
				}
			}
		},
		{ onWait: ctx.log, signal: ctx.signal, poll: 2000 }
	);
}

/**
 * What `simctl ui <udid> content_size` is set to for each text size. The same steps the Swift snapshot driver uses
 * (accessibility 1, 3 and 5), so a `large` screenshot means the same thing on every path.
 */
export const CONTENT_SIZE: Record<string, string> = {
	default: 'large',
	large: 'accessibility-medium',
	xlarge: 'accessibility-extra-large',
	xxl: 'accessibility-extra-extra-extra-large'
};
