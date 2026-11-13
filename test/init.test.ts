import { expect, test } from 'bun:test';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_LINE, init, undoAgents } from '../src/init.ts';

const quietly = async (run: () => Promise<number>) => {
	const write = process.stdout.write;
	process.stdout.write = (() => true) as typeof process.stdout.write;
	try {
		return await run();
	} finally {
		process.stdout.write = write;
	}
};

test('a folder with no app gets no config, and a usage exit', async () => {
	const folder = mkdtempSync(join(tmpdir(), 'fs-init-'));
	expect(await quietly(() => init({ cwd: folder }))).toBe(2);
	expect(existsSync(join(folder, 'facetshot.config.ts'))).toBe(false);
});

test('--url writes a config that only visits, plain when facetshot is not installed', async () => {
	const folder = mkdtempSync(join(tmpdir(), 'fs-init-'));
	expect(await quietly(() => init({ cwd: folder, url: 'https://staging.example.com/' }))).toBe(0);
	const text = readFileSync(join(folder, 'facetshot.config.ts'), 'utf8');
	expect(text).toContain("baseURL: 'https://staging.example.com'");
	expect(text).not.toContain('import');
	expect(text).not.toContain('build:');
});

test('a Vite project gets a build and a preview server, typed when installed', async () => {
	const folder = mkdtempSync(join(tmpdir(), 'fs-init-'));
	writeFileSync(join(folder, 'package.json'), JSON.stringify({ devDependencies: { vite: '7' } }));
	mkdirSync(join(folder, 'node_modules', 'facetshot'), { recursive: true });
	expect(await quietly(() => init({ cwd: folder }))).toBe(0);
	const text = readFileSync(join(folder, 'facetshot.config.ts'), 'utf8');
	expect(text).toContain("import { defineConfig } from 'facetshot'");
	expect(text).toContain('vite build');
	expect(text).toContain('vite preview');
});

test("uninstall's undo removes only what init --agent put in, keeping other servers", async () => {
	const folder = mkdtempSync(join(tmpdir(), 'fs-init-'));
	const other = { command: 'other-server', args: ['serve'] };
	writeFileSync(join(folder, '.mcp.json'), JSON.stringify({ mcpServers: { other } }));
	mkdirSync(join(folder, '.codex'));
	writeFileSync(
		join(folder, '.codex', 'config.toml'),
		'model = "x"\n\n[mcp_servers.other]\ncommand = "other-server"\n'
	);
	mkdirSync(join(folder, '.claude', 'skills', 'mine'), { recursive: true });
	expect(
		await quietly(() => init({ cwd: folder, url: 'http://localhost:3000', agent: 'all' }))
	).toBe(0);
	expect(existsSync(join(folder, '.cursor', 'rules', 'facetshot.mdc'))).toBe(true);

	for (const each of undoAgents(folder)) each.apply();
	expect(undoAgents(folder)).toEqual([]);
	expect(JSON.parse(readFileSync(join(folder, '.mcp.json'), 'utf8'))).toEqual({
		mcpServers: { other }
	});
	expect(readFileSync(join(folder, '.codex', 'config.toml'), 'utf8')).toBe(
		'model = "x"\n\n[mcp_servers.other]\ncommand = "other-server"\n'
	);
	// Cursor's files held only facetshot: gone, folder and all. The person's own skill and config stay.
	expect(existsSync(join(folder, '.cursor'))).toBe(false);
	expect(existsSync(join(folder, '.claude', 'skills', 'facetshot'))).toBe(false);
	expect(existsSync(join(folder, '.claude', 'skills', 'mine'))).toBe(true);
	expect(existsSync(join(folder, '.agents'))).toBe(false);
	expect(existsSync(join(folder, 'facetshot.config.ts'))).toBe(true);
});

test("uninstall's undo removes a linked skill without touching what it points at", async () => {
	const folder = mkdtempSync(join(tmpdir(), 'fs-init-'));
	const target = mkdtempSync(join(tmpdir(), 'fs-skill-'));
	writeFileSync(join(target, 'SKILL.md'), 'kept');
	mkdirSync(join(folder, '.claude', 'skills'), { recursive: true });
	symlinkSync(target, join(folder, '.claude', 'skills', 'facetshot'));
	for (const each of undoAgents(folder)) each.apply();
	expect(existsSync(join(folder, '.claude'))).toBe(false);
	expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toBe('kept');
});

test('init --agent --yes adds the line to CLAUDE.md, and undo takes exactly that line out', async () => {
	const folder = mkdtempSync(join(tmpdir(), 'fs-init-'));
	writeFileSync(join(folder, 'CLAUDE.md'), '# Notes\n\nOur own rule.\n');
	await quietly(() =>
		init({ cwd: folder, url: 'http://localhost:3000', agent: 'claude', yes: true })
	);
	expect(readFileSync(join(folder, 'CLAUDE.md'), 'utf8')).toContain(AGENT_LINE);
	for (const each of undoAgents(folder)) each.apply();
	expect(readFileSync(join(folder, 'CLAUDE.md'), 'utf8')).toBe('# Notes\n\nOur own rule.\n');

	// No instructions file yet: one is made for the agent (AGENTS.md for Codex), and goes again on undo.
	const bare = mkdtempSync(join(tmpdir(), 'fs-init-'));
	await quietly(() => init({ cwd: bare, url: 'http://localhost:3000', agent: 'codex', yes: true }));
	expect(readFileSync(join(bare, 'AGENTS.md'), 'utf8')).toBe(`${AGENT_LINE}\n`);
	for (const each of undoAgents(bare)) each.apply();
	expect(existsSync(join(bare, 'AGENTS.md'))).toBe(false);
});
