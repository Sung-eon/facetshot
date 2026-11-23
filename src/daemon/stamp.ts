/**
 * Which facetshot code a process runs, so a client never hands work to a daemon started from older code (after an
 * upgrade, or while working on facetshot itself). By content, not modification time: a checkout, a copy or a touched
 * file with the same code keeps the helper, and with it every warm browser, server and simulator.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { listFiles } from '../engine/cache.ts';
import { VERSION } from '../version.ts';

export function codeStamp(): string {
	const root = new URL('..', import.meta.url).pathname;
	const hash = createHash('sha256').update(VERSION);
	for (const path of listFiles(root).sort())
		if (path.endsWith('.ts')) hash.update(`${relative(root, path)}\0`).update(readFileSync(path));
	return hash.digest('hex').slice(0, 12);
}
