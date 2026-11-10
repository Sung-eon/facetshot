import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The engine knows no project: nothing in src/ names one, or imports from outside the package. */
test('the engine is project-agnostic', () => {
	const files: string[] = [];
	const walk = (folder: string) => {
		for (const name of readdirSync(folder)) {
			const path = join(folder, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (/\.(ts|swift)$/.test(name)) files.push(path);
		}
	};
	walk(join(import.meta.dir, '..', 'src'));
	expect(files.length).toBeGreaterThan(10);
	for (const file of files) {
		const text = readFileSync(file, 'utf8');
		expect(text, file).not.toMatch(/\bknot\b|sung-?eon/i);
		for (const [, spec] of text.matchAll(/from '([^']+)'/g)) {
			expect(
				spec.startsWith('../../') && !spec.startsWith('../../src'),
				`${file} imports ${spec}`
			).toBe(false);
		}
	}
});

/** Nothing in the package — docs, skill, examples, Swift — is written for one project or person. */
test('the package names no project or person', () => {
	const root = join(import.meta.dir, '..');
	const skip = new Set(['node_modules', '.build', '.facetshot', 'dist', 'target']);
	const files: string[] = [];
	const walk = (folder: string) => {
		for (const name of readdirSync(folder)) {
			if (skip.has(name) || name.startsWith('.svelte-kit')) continue;
			const path = join(folder, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (
				/\.(ts|tsx|js|mjs|swift|md|json|yaml|yml|html|css|toml|rs)$/.test(name) &&
				!name.endsWith('.lock')
			)
				files.push(path);
		}
	};
	walk(root);
	expect(files.length).toBeGreaterThan(50);
	for (const file of files) {
		if (file === import.meta.path) continue;
		expect(readFileSync(file, 'utf8'), file).not.toMatch(/\bknot\b|sung-?eon/i);
	}
});
