import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, unknownKeys } from '../src/config.ts';
import { stateDir } from '../src/run.ts';

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

/** A misspelt key would otherwise do nothing: every unknown key is named, with the key it most likely meant. */
test('unknown config keys are warned about, with a suggestion, at every level whose shape is fixed', async () => {
	expect(
		unknownKeys({
			out: 'shots',
			devices: { phone: { width: 390, heigth: 844, safeArea: { top: 1, botom: 2 } } },
			web: {
				baseURL: 'http://localhost:3000',
				serve: { cmd: 'x', prot: 3000 },
				ready: { routes: { '/a': { idel: 1 } } }
			},
			servces: {},
			aliases: { anything: '/goes' },
			storybook: { globals: { dark: 'theme:dark' } },
			limits: { lockNames: { biuld: 'x' } },
			zzzzzz: 1
		})
	).toEqual([
		'unknown key "devices.phone.heigth" is ignored (did you mean "devices.phone.height"?).',
		'unknown key "devices.phone.safeArea.botom" is ignored (did you mean "devices.phone.safeArea.bottom"?).',
		'unknown key "web.serve.prot" is ignored (did you mean "web.serve.port"?).',
		'unknown key "web.ready.routes./a.idel" is ignored (did you mean "web.ready.routes./a.idle"?).',
		'unknown key "servces" is ignored (did you mean "services"?).',
		'unknown key "limits.lockNames.biuld" is ignored (did you mean "limits.lockNames.build"?).',
		'unknown key "zzzzzz" is ignored.'
	]);
	// The loader reports them and still loads the config.
	const folder = mkdtempSync(join(tmpdir(), 'facetshot-config-'));
	writeFileSync(
		join(folder, 'facetshot.config.ts'),
		"export default { web: { baseUrl: 'http://localhost:1' } };\n"
	);
	const loaded = await loadConfig({ cwd: folder });
	expect(loaded.warnings).toEqual([
		`${loaded.file}: unknown key "web.baseUrl" is ignored (did you mean "web.baseURL"?).`
	]);
});

/** `-c .facetshot/facetshot.config.ts` must not write to `.facetshot/.facetshot`. */
test('a config kept inside the state folder uses that folder, not one nested in it', async () => {
	const project = realpathSync(mkdtempSync(join(tmpdir(), 'facetshot-config-')));
	mkdirSync(join(project, '.facetshot', 'configs'), { recursive: true });
	for (const file of [
		'.facetshot/facetshot.config.ts',
		'.facetshot/configs/facetshot.config.ts',
		'facetshot.config.ts'
	])
		writeFileSync(join(project, file), 'export default {};\n');
	const inState = await loadConfig({ file: join(project, '.facetshot', 'facetshot.config.ts') });
	expect(stateDir(inState.config)).toBe(join(project, '.facetshot'));
	const deeper = await loadConfig({ file: '.facetshot/configs/facetshot.config.ts', cwd: project });
	expect(stateDir(deeper.config)).toBe(join(project, '.facetshot'));
	// Paths in the config stay relative to its own folder.
	expect(deeper.root).toBe(join(project, '.facetshot', 'configs'));
	const usual = await loadConfig({ cwd: project });
	expect(stateDir(usual.config)).toBe(join(project, '.facetshot'));
});
