import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'facetshot-ports-'));
process.env.FACETSHOT_HOME = home;
const { stablePorts } = await import('../src/ports.ts');
afterAll(() => rmSync(home, { recursive: true, force: true }));

test('a folder keeps its ports, and another folder gets different ones', () => {
	const a = mkdtempSync(join(home, 'a-'));
	const b = mkdtempSync(join(home, 'b-'));
	const first = stablePorts(a, 2);
	expect(first).toEqual([5400, 5401]);
	expect(stablePorts(a, 2)).toEqual(first);
	expect(stablePorts(b, 2)).toEqual([5402, 5403]);
});

test('a folder that is gone gives its ports back', () => {
	const gone = mkdtempSync(join(home, 'gone-'));
	const ports = stablePorts(gone, 2, { from: 6000, to: 6003 });
	rmSync(gone, { recursive: true });
	const next = mkdtempSync(join(home, 'next-'));
	expect(stablePorts(next, 2, { from: 6000, to: 6003 })).toEqual(ports);
});

test('a full range says so', () => {
	const one = mkdtempSync(join(home, 'one-'));
	const two = mkdtempSync(join(home, 'two-'));
	stablePorts(one, 2, { from: 7000, to: 7001 });
	expect(() => stablePorts(two, 2, { from: 7000, to: 7001 })).toThrow(/No 2 free ports/);
});

test('settings of one folder with a key each get blocks of their own, and keep them', () => {
	const folder = mkdtempSync(join(home, 'keyed-'));
	const plain = stablePorts(folder, 2, { from: 8000, to: 8099 });
	const one = stablePorts(folder, 2, { from: 8000, to: 8099, key: 'db_one' });
	const two = stablePorts(folder, 2, { from: 8000, to: 8099, key: 'db_two' });
	expect(new Set([...plain, ...one, ...two]).size).toBe(6);
	// Another folder asking doesn't take a keyed block away (the folder still exists).
	stablePorts(mkdtempSync(join(home, 'other-')), 2, { from: 8000, to: 8099 });
	expect(stablePorts(folder, 2, { from: 8000, to: 8099, key: 'db_one' })).toEqual(one);
});
