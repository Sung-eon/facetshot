/**
 * `facetshot uninstall`: takes facetshot off the machine. It lists exactly what it will remove, asks, and removes
 * only those paths: the background helper, facetshot's own simulators, its home folder, what `init --agent` put in
 * this project (`undoAgents`), with `--browsers` the browsers its Playwright installed, and last the global package.
 */
import { spawn } from 'node:child_process';
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { findConfig, homeFolder } from './config.ts';
import { EXIT } from './errors.ts';
import { undoAgents } from './init.ts';

/**
 * How facetshot itself is installed, judged by where this file is: Bun's global folder, bunx's cache (a `bunx-<uid>-facetshot@<version>` folder in the temp folder, which Bun manages itself), a
 * project's node_modules, or a checkout.
 */
export function installedAs(): 'global' | 'project' | 'bunx' | 'checkout' {
	const real = (path: string) => {
		try {
			return realpathSync(path);
		} catch {
			return path;
		}
	};
	const own = real(fileURLToPath(import.meta.url));
	const global = real(
		process.env.BUN_INSTALL_GLOBAL_DIR ??
			join(process.env.BUN_INSTALL ?? join(homedir(), '.bun'), 'install', 'global')
	);
	if (own.startsWith(global + sep)) return 'global';
	if (/[\\/]bunx-[^\\/]*facetshot[^\\/]*[\\/]/.test(own)) return 'bunx';
	return own.includes(`${sep}node_modules${sep}facetshot${sep}`) ? 'project' : 'checkout';
}

function run(command: string, args: string[]): Promise<number> {
	return new Promise((done) => {
		const child = spawn(command, args, { stdio: 'inherit' });
		child.on('error', () => done(EXIT.internal));
		child.on('exit', (code) => done(code ?? EXIT.internal));
	});
}

export async function uninstall(options: {
	yes?: boolean;
	browsers?: boolean;
	cwd?: string;
}): Promise<number> {
	const say = (line: string) => process.stdout.write(`${line}\n`);
	const cwd = options.cwd ?? process.cwd();
	const config = findConfig(cwd);
	const root = config ? dirname(config) : cwd;
	const { status, daemonCommand } = await import('./daemon/client.ts');
	const { ownSimulatorList, deleteSimulators } = await import('./clean.ts');
	const { browsersFolder, playwright } = await import('./setup.ts');

	const daemon = await status().catch(() => undefined);
	const simulators = await ownSimulatorList();
	const home = homeFolder();
	const undo = undoAgents(root);
	const state = join(root, '.facetshot');
	const projectState = existsSync(state);
	const how = installedAs();
	const browsers = browsersFolder();

	const plan: string[] = [];
	if (daemon) plan.push(`stop the background helper (pid ${daemon.pid})`);
	for (const device of simulators) plan.push(`delete simulator ${device.name}`);
	if (existsSync(home)) plan.push(`delete ${home}`);
	if (projectState) plan.push(`delete ${state} (screenshots, logs, baselines)`);
	for (const each of undo) plan.push(`${join(root, each.path)}: ${each.what}`);
	if (options.browsers)
		plan.push(
			`run facetshot's Playwright uninstall: deletes the browsers in ${browsers ?? "facetshot's install"} that no other Playwright on this machine still uses`
		);
	if (how === 'global') plan.push('remove the facetshot package: bun remove -g facetshot');

	if (!plan.length) say('Nothing of facetshot to remove here.');
	else {
		say('facetshot uninstall will:');
		for (const line of plan) say(`  - ${line}`);
		if (!options.yes) {
			if (!process.stdin.isTTY) {
				say('Nothing removed. Run again with --yes to remove these.');
				return EXIT.usage;
			}
			const ask = createInterface({ input: process.stdin, output: process.stdout });
			const answer = await ask.question('Remove these? [y/N] ');
			ask.close();
			if (!/^y(es)?$/i.test(answer.trim())) {
				say('Nothing removed.');
				return EXIT.ok;
			}
		}
	}

	if (daemon) await daemonCommand('stop');
	await deleteSimulators(simulators, say);
	for (const each of undo) each.apply();
	if (projectState) rmSync(state, { recursive: true, force: true });
	if (existsSync(home)) rmSync(home, { recursive: true, force: true });
	if (plan.length) say('Removed.');

	// What stays, and how to take it away by hand.
	if (config) say(`Kept your config. Delete it if you no longer want it: rm ${config}`);
	if (options.browsers) {
		const code = await playwright(['uninstall']);
		if (code !== 0) say("Playwright couldn't remove the browsers (its message is above).");
	} else if (browsers) {
		say(
			`Playwright's browsers stay in ${browsers}; other Playwright projects may use them. facetshot uninstall --browsers removes the ones nothing else uses.`
		);
	}
	if (how === 'global') return run(process.execPath, ['remove', '-g', 'facetshot']);
	if (how === 'project')
		say('facetshot is installed in this project; remove it with: bun remove facetshot');
	if (how === 'bunx')
		say(
			"facetshot ran through bunx, so nothing is installed globally; bunx's cached copy is Bun's to clear."
		);
	return EXIT.ok;
}
