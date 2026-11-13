/** What `facetshot list` and the MCP `list` tool print: one implementation for both. */
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CHECK_HELP } from './checks/page.ts';
import { UsageError } from './errors.ts';
import { loadFlow, shotNames } from './flows.ts';
import { allDevices, allVariants } from './plan.ts';
import { GROUPS, PROFILES, VARIANT_GROUPS } from './presets.ts';
import { listRuns, readManifest, stateDir } from './run.ts';
import type { Config } from './types.ts';

export const LISTS = [
	'devices',
	'variants',
	'profiles',
	'flows',
	'checks',
	'runs',
	'sessions'
] as const;
export type ListName = (typeof LISTS)[number];

/** Folders never searched for flows: dependencies, build output, and anything hidden. */
const SKIP = new Set(['node_modules', 'dist', 'build', 'target', 'out', 'DerivedData', 'Pods']);

/** Flow files in the project (YAML or JSON with a start and steps), at most four folders deep. */
export function findFlows(root: string): string[] {
	const found: string[] = [];
	const walk = (folder: string, depth: number) => {
		let entries;
		try {
			entries = readdirSync(folder, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
			const path = join(folder, entry.name);
			if (entry.isDirectory()) {
				if (depth < 4) walk(path, depth + 1);
			} else if (/\.(ya?ml|json)$/.test(entry.name)) {
				try {
					loadFlow(path, root);
					found.push(relative(root, path));
				} catch {
					// Not a flow: some other YAML or JSON file.
				}
			}
		}
	};
	walk(root, 0);
	return found.sort();
}

export async function listing(what: string, config: Config): Promise<string> {
	const root = config.root ?? process.cwd();
	const out: string[] = [];
	switch (what as ListName) {
		case 'devices': {
			const devices = Object.values(allDevices(config));
			for (const platform of ['web', 'ios', 'window'] as const) {
				out.push(`${platform}:`);
				for (const device of devices.filter((d) => d.platform === platform))
					out.push(
						`  ${device.name.padEnd(18)} ${device.width}×${device.height} @${device.scale}x${device.model ? `  ${device.model}` : ''}`
					);
			}
			out.push('groups:');
			for (const [name, members] of Object.entries({ ...GROUPS, ...config.groups }))
				out.push(`  ${name.padEnd(18)} ${members.join(', ')}`);
			break;
		}
		case 'variants': {
			for (const { name, ...axes } of Object.values(allVariants(config)))
				out.push(
					`  ${name.padEnd(12)} ${Object.entries(axes)
						.map(([k, v]) => `${k}=${v}`)
						.join(' ')}`
				);
			out.push('groups:');
			for (const [name, members] of Object.entries(VARIANT_GROUPS))
				out.push(`  ${name.padEnd(12)} ${members.join(', ')}`);
			out.push('Combine with "+": dark+large');
			break;
		}
		case 'profiles':
			for (const [name, profile] of Object.entries({ ...PROFILES, ...config.profiles }))
				out.push(
					`  ${name.padEnd(12)} ${profile.targets?.length ? `${profile.targets.join(' ')}  ` : ''}on ${profile.on.join(', ')}  as ${profile.as.join(', ')}`
				);
			break;
		case 'flows': {
			for (const file of findFlows(root)) {
				const flow = loadFlow(file, root);
				const shots = shotNames(flow);
				out.push(
					`  ${file}  from ${flow.start}, ${flow.steps.length} steps, shots: ${shots.join(', ')}`
				);
			}
			if (!out.length)
				out.push('No flows yet. Save one from a session: close --save flows/name.yaml');
			break;
		}
		case 'checks':
			for (const [name, help] of Object.entries(CHECK_HELP))
				out.push(`  ${name.padEnd(10)} ${help}`);
			break;
		case 'runs':
			for (const id of listRuns(config).slice(0, 20)) {
				const manifest = readManifest(join(stateDir(config), 'runs', id));
				out.push(
					`  ${id}  ${manifest ? `${manifest.counts.ok}/${manifest.cells.length} ok, ${manifest.screens.map((s) => s.screen).join(' ')}` : '(incomplete)'}`
				);
			}
			if (!out.length) out.push('No runs yet.');
			break;
		case 'sessions': {
			const { listSessions } = await import('./daemon/client.ts');
			for (const each of await listSessions())
				out.push(
					`  ${each.id}  ${each.device}/${each.variant}  ${each.url}  ${each.steps} steps, idle ${each.idleSeconds}s  (${each.root})`
				);
			if (!out.length) out.push('No sessions open.');
			break;
		}
		default:
			throw new UsageError(`I can't list "${what}".`, `Try: ${LISTS.join(', ')}.`);
	}
	return out.join('\n');
}
