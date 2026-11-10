import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { init } from '../src/init.ts';

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
