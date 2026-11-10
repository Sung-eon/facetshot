/**
 * `facetshot clean`: puts the machine back as it was — the daemon and everything it holds stopped, test data
 * removed, pictures and caches deleted, facetshot's own simulators deleted. Baselines stay unless `--all`.
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

	const { config, root } = await loadConfig({ file: options.configFile });
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
		...(options.all ? ['baselines'] : [])
	]) {
		rmSync(join(state, folder), { recursive: true, force: true });
	}
	say(
		`Removed runs and logs in ${state}${options.all ? ' (baselines too)' : ' (baselines kept; --all removes them)'}.`
	);
	rmSync(join(homeFolder(), 'cache'), { recursive: true, force: true });

	if (process.platform === 'darwin') {
		try {
			const { ownSimulators, simctl } = await import('./drivers/simctl.ts');
			for (const device of await ownSimulators()) {
				if (device.state === 'Booted') await simctl('shutdown', device.udid).catch(() => {});
				await simctl('delete', device.udid);
				say(`Deleted simulator ${device.name}.`);
			}
		} catch {
			// No Xcode: nothing of ours to delete.
		}
	}
	return EXIT.ok;
}
