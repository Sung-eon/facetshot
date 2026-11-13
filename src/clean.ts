/**
 * `facetshot clean`: puts the machine back as it was — the daemon and everything it holds stopped, test data
 * removed, screenshots and caches deleted, facetshot's own simulators deleted. Baselines stay unless `--all`.
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homeFolder, loadConfig } from './config.ts';
import { EXIT, explain } from './errors.ts';
import { newContext, startServices, stateDir } from './run.ts';
import { Runtime } from './engine/runtime.ts';
import { Pool } from './engine/scheduler.ts';
import { removeAllFixtures } from './fixtures.ts';

export async function clean(options: { configFile?: string; all?: boolean }): Promise<number> {
	const say = (line: string) => process.stdout.write(`${line}\n`);
	const { daemonCommand, status } = await import('./daemon/client.ts');
	if (await status()) {
		await daemonCommand('stop');
	}

	const { config } = await loadConfig({ file: options.configFile });
	const state = stateDir(config);

	// Test data a crashed run left: removing it may need the project's services (an API), so start them for this.
	if (config.fixtures?.remove && existsSync(join(state, 'fixtures.ledger.json'))) {
		const runtime = new Runtime();
		const ctx = newContext(config, {
			runId: 'clean',
			runDir: state,
			checks: [],
			images: false,
			runtime,
			pools: { web: new Pool(1), simulators: new Pool(1) },
			log: say,
			signal: new AbortController().signal,
			atEnd: () => {}
		});
		try {
			await startServices(ctx);
			const removed = await removeAllFixtures(ctx);
			say(`Removed ${removed} item(s) of test data.`);
		} catch (error) {
			say(`Couldn't remove test data: ${explain(error)}`);
		} finally {
			await runtime.close();
		}
	}

	for (const folder of [
		'runs',
		'logs',
		'builds',
		'latest',
		'swift-derived',
		'last-request.json',
		// Saved sign-ins: personas sign in again on the next run.
		'auth',
		'sessions',
		// Steps given inline (--do, MCP steps) are kept as flow files here; they may hold typed text.
		'flows',
		...(options.all ? ['baselines'] : [])
	]) {
		rmSync(join(state, folder), { recursive: true, force: true });
	}
	say(
		`Removed runs, logs and saved sign-ins in ${state}${options.all ? ' (baselines too)' : ' (baselines kept; --all removes them)'}.`
	);
	rmSync(join(homeFolder(), 'cache'), { recursive: true, force: true });

	await deleteSimulators(await ownSimulatorList(), say);
	return EXIT.ok;
}

/** facetshot's own iOS simulators (named facetshot-…); none without a Mac or Xcode. */
export async function ownSimulatorList(): Promise<{ name: string; udid: string; state: string }[]> {
	if (process.platform !== 'darwin') return [];
	try {
		const { ownSimulators } = await import('./drivers/simctl.ts');
		return await ownSimulators();
	} catch {
		return [];
	}
}

export async function deleteSimulators(
	devices: { name: string; udid: string; state: string }[],
	say: (line: string) => void
): Promise<void> {
	if (!devices.length) return;
	const { simctl } = await import('./drivers/simctl.ts');
	for (const device of devices) {
		if (device.state === 'Booted') await simctl('shutdown', device.udid).catch(() => {});
		await simctl('delete', device.udid).then(
			() => say(`Deleted simulator ${device.name}.`),
			(error) => say(`Couldn't delete simulator ${device.name}: ${explain(error)}`)
		);
	}
}
