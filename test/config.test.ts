import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';

/** In the daemon, a config is read in the environment of whoever asked: that is how an agent picks its database. */
test("a config is read in the caller's environment, and only what it reads changes its stamp", async () => {
	const folder = mkdtempSync(join(tmpdir(), 'facetshot-config-'));
	writeFileSync(
		join(folder, 'facetshot.config.ts'),
		"export default { aliases: { db: process.env.SHOTS_TEST_DB ?? 'shared' } };\n"
	);
	const shared = await loadConfig({ cwd: folder, env: { HOME: '/x', UNRELATED: '1' } });
	const unrelated = await loadConfig({ cwd: folder, env: { HOME: '/x', UNRELATED: '2' } });
	const own = await loadConfig({ cwd: folder, env: { HOME: '/x', SHOTS_TEST_DB: 'mine' } });
	expect(shared.config.aliases?.db).toBe('shared');
	expect(own.config.aliases?.db).toBe('mine');
	expect(unrelated.stamp).toBe(shared.stamp);
	expect(own.stamp).not.toBe(shared.stamp);
	// The caller's environment is lent for the read only.
	expect(process.env.SHOTS_TEST_DB).toBeUndefined();
});
