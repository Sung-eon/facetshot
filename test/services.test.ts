import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureService, freePort, type Running } from '../src/engine/procs.ts';

const root = mkdtempSync(join(tmpdir(), 'facetshot-services-'));
const started: Running[] = [];
afterAll(async () => {
	for (const each of started) await each.stop();
	rmSync(root, { recursive: true, force: true });
});

const server = (port: number, label: string) => ({
	cmd: `bun -e "Bun.serve({ port: ${port}, fetch: () => new Response(process.env.LABEL) })"`,
	port,
	env: { LABEL: label }
});
const ctx = { root, stateDir: join(root, '.facetshot'), values: {}, log: () => {} };

test('a server started with other settings is never borrowed', async () => {
	const port = await freePort();
	const first = await ensureService('api', server(port, 'one'), ctx);
	started.push(first);
	expect(first.owned).toBe(true);
	// The same settings again: the running server is the service.
	const again = await ensureService('api', server(port, 'one'), ctx);
	expect(again.url).toBe(first.url);
	// Another environment on the same port: an error naming the holder, not a borrowed server.
	await expect(ensureService('api', server(port, 'two'), ctx)).rejects.toThrow(/other settings/);
});
