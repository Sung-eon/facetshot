/**
 * Which facetshot code a process runs, so a client never hands work to a daemon started from older code (after an
 * upgrade, or while working on facetshot itself).
 */
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { listFiles } from '../engine/cache.ts';
import { VERSION } from '../version.ts';

export function codeStamp(): string {
	const hash = createHash('sha256').update(VERSION);
	for (const path of listFiles(new URL('..', import.meta.url).pathname))
		if (path.endsWith('.ts')) hash.update(`${path}:${statSync(path).mtimeMs}`);
	return hash.digest('hex').slice(0, 12);
}
