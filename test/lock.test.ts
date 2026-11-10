import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { tryLock } from '../src/engine/lock.ts';

test('one holder at a time, and released for the next', () => {
	const path = join(mkdtempSync(join(tmpdir(), 'fs-lock-')), 'build.lock');
	const release = tryLock(path, 'first');
	expect(release).toBeDefined();
	expect(tryLock(path, 'second')).toBeUndefined();
	release!();
	expect(tryLock(path, 'third')).toBeDefined();
});

test("a lock whose owner is gone is taken over; a script's lock (no note) is respected", () => {
	const folder = mkdtempSync(join(tmpdir(), 'fs-lock-'));
	const stale = join(folder, 'stale.lock');
	mkdirSync(stale);
	writeFileSync(
		join(stale, 'owner.json'),
		JSON.stringify({ pid: 2 ** 22 + 7, host: hostname(), what: 'gone', since: '' })
	);
	expect(tryLock(stale, 'me')).toBeDefined();
	const script = join(folder, 'script.lock');
	mkdirSync(script);
	expect(tryLock(script, 'me')).toBeUndefined();
});
