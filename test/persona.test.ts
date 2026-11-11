import { afterAll, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { run } from '../src/run.ts';
import { Runtime } from '../src/engine/runtime.ts';
import { Session } from '../src/session.ts';

const site = join(import.meta.dir, 'fixtures', 'login-site');
afterAll(() => rmSync(join(site, '.facetshot'), { recursive: true, force: true }));

test('a persona signs in once through its login flow, and its pages are signed in', async () => {
	const { config } = await loadConfig({ cwd: site });
	const runtime = new Runtime();
	try {
		const { session, view } = await Session.open(
			{ target: '/account.html' },
			config,
			runtime,
			undefined,
			() => {}
		);
		try {
			expect(existsSync(join(site, '.facetshot', 'auth', 'member.json'))).toBe(true);
			const look = await session.look({ tree: true, picture: false });
			expect(look.tree).toContain('Hello, Ada');
			expect(view.url).toContain('/account.html');
		} finally {
			await session.close();
		}
		// A run uses the kept sign-in too.
		const manifest = await run({ targets: ['/account.html'] }, { config, runtime });
		expect(manifest.counts.failed).toBe(0);
	} finally {
		await runtime.close();
	}
}, 120_000);
