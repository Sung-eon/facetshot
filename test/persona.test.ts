import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

test('a session saves its steps only as a flow file inside the project, never over another file', () => {
	const root = mkdtempSync(join(tmpdir(), 'facetshot-save-'));
	try {
		writeFileSync(join(root, 'package.json'), '{}');
		const session = new Session(
			's-test',
			root,
			{ stateDir: join(root, '.facetshot') } as never,
			root
		);
		session.steps.push({ click: 'role=button[name="Save"]' });
		expect(() => session.saveFlow('notes.txt')).toThrow(/isn't a flow file name/);
		expect(() => session.saveFlow('package.json')).toThrow(/isn't a flow, so it was left alone/);
		writeFileSync(join(root, 'notes.yaml'), 'title: not a flow\n');
		expect(() => session.saveFlow('notes.yaml')).toThrow(/isn't a flow/);
		expect(() => session.saveFlow('../outside.yaml')).toThrow(/inside the project/);
		const saved = session.saveFlow('flows/save.yaml');
		expect(readFileSync(saved, 'utf8')).toContain('click: role=button[name="Save"]');
		// A flow may be saved over a flow.
		expect(session.saveFlow('flows/save.yaml')).toBe(saved);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
