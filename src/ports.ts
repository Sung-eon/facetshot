/**
 * Ports that stay the same for a checkout and differ between checkouts.
 *
 * `port: 'auto'` is enough for most servers, but some ports end up inside a build (an API's address in the web
 * bundle, an allowed origin): those must not change from run to run, or every run rebuilds. And two checkouts of the
 * same project — two agents in two worktrees — must not get the same ones, or one stops the other's server.
 * `stablePorts` answers both: the first time a project folder asks, it is given the lowest block of ports no other
 * folder holds, written to a machine-wide ledger (`~/.facetshot/ports.json`); afterwards it gets the same block. A
 * folder that no longer exists gives its block back.
 *
 * It runs while the config is loaded, so it is synchronous.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homeFolder } from './config.ts';

export interface StablePortsOptions {
	/** The first port of the range blocks are taken from. Default 5400. */
	from?: number;
	/** The last port of the range. Default 5999. */
	to?: number;
	/**
	 * One setting of this checkout that runs beside others (a database name, say): each gets a block of its own, so two
	 * agents in one checkout with different settings never share a server.
	 */
	key?: string;
}

type Ledger = Record<string, { base: number; count: number }>;

export function stablePorts(
	root: string,
	count: number,
	options: StablePortsOptions = {}
): number[] {
	const from = options.from ?? 5400;
	const to = options.to ?? 5999;
	const folder = homeFolder();
	const file = join(folder, 'ports.json');
	const key = options.key ? `${resolve(root)}#${options.key}` : resolve(root);
	let ledger: Ledger = {};
	try {
		ledger = JSON.parse(readFileSync(file, 'utf8')) as Ledger;
	} catch {
		// No ledger yet, or an unreadable one: start a new one.
	}
	// Folders that are gone (a removed worktree) give their ports back.
	for (const folderKey of Object.keys(ledger))
		if (!existsSync(folderKey.split('#')[0])) delete ledger[folderKey];

	const held = ledger[key];
	if (held && held.count >= count && held.base >= from && held.base + count - 1 <= to) {
		return Array.from({ length: count }, (_, index) => held.base + index);
	}
	const taken = Object.entries(ledger)
		.filter(([other]) => other !== key)
		.map(([, block]) => [block.base, block.base + block.count - 1] as const);
	for (let base = from; base + count - 1 <= to; base += count) {
		const end = base + count - 1;
		if (taken.some(([start, stop]) => base <= stop && end >= start)) continue;
		ledger[key] = { base, count };
		mkdirSync(folder, { recursive: true });
		// Written whole and moved into place, so two configs loading at once never read half a file.
		writeFileSync(`${file}.${process.pid}`, JSON.stringify(ledger, null, '\t'));
		renameSync(`${file}.${process.pid}`, file);
		return Array.from({ length: count }, (_, index) => base + index);
	}
	throw new Error(
		`No ${count} free ports left between ${from} and ${to} for ${key}. Remove stale entries from ${file}, or pass a wider range.`
	);
}
