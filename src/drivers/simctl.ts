/**
 * The iOS simulator, through `xcrun simctl`. facetshot only ever uses simulators it made itself (named
 * `facetshot-<model>`), so the ones a person keeps for their own work are never booted, changed or erased.
 */
import { exec } from '../engine/procs.ts';
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
 * What `simctl ui <udid> content_size` is set to for each text size. The same steps the Swift snapshot driver uses
 * (accessibility 1, 3 and 5), so a `large` picture means the same thing on every path.
 */
export const CONTENT_SIZE: Record<string, string> = {
	default: 'large',
	large: 'accessibility-medium',
	xlarge: 'accessibility-extra-large',
	xxl: 'accessibility-extra-extra-extra-large'
};
