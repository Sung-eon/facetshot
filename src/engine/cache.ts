/**
 * "Has anything this build reads changed?" answered by a hash of the inputs' contents.
 *
 * In a git checkout the index already knows every tracked file's content hash, so only edited and new files are
 * read; outside git, files are walked and hashed by size and modification time.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

function git(root: string, args: string[]): string | undefined {
	try {
		return execFileSync('git', ['-C', root, ...args], {
			encoding: 'utf8',
			maxBuffer: 256 * 1024 * 1024,
			stdio: ['ignore', 'pipe', 'ignore']
		});
	} catch {
		return undefined;
	}
}

const SKIP = new Set([
	'node_modules',
	'.git',
	'.svelte-kit',
	'dist',
	'build',
	'.build',
	'DerivedData',
	'.facetshot'
]);

/** Every file under `path` (or `path` itself, if it is a file) in a stable order, leaving out names `skip` says. */
export function listFiles(path: string, skip: (name: string) => boolean = () => false): string[] {
	if (!existsSync(path)) return [];
	if (statSync(path).isFile()) return [path];
	return readdirSync(path)
		.sort((a, b) => a.localeCompare(b))
		.filter((name) => !skip(name))
		.flatMap((name) => listFiles(join(path, name), skip));
}

function walk(folder: string, hash: ReturnType<typeof createHash>, root: string): void {
	const skip = (name: string) => SKIP.has(name) || name.startsWith('.facetshot');
	for (const file of listFiles(folder, skip)) {
		const stat = statSync(file);
		hash.update(`${relative(root, file)}:${stat.size}:${stat.mtimeMs}\n`);
	}
}

/** A short hash of everything under `inputs` (relative to `root`), plus any extra strings (the command, its env). */
export function inputsHash(root: string, inputs: string[], extra: string[] = []): string {
	const hash = createHash('sha256');
	for (const item of extra) hash.update(`extra:${item}\n`);
	const top = git(root, ['rev-parse', '--show-toplevel'])?.trim();
	const paths = inputs.map((input) => resolve(root, input));
	if (top) {
		// Only paths inside this repository go to git: one outside it makes git refuse the whole command, and the
		// hash would silently stop seeing any change here.
		const rel = paths
			.map((path) => relative(top, path) || '.')
			.filter((path) => !path.startsWith('..'));
		// Tracked files as git holds them…
		hash.update(rel.length ? (git(top, ['ls-files', '-s', '--', ...rel]) ?? '') : '');
		// …and what differs from that: edited, added, deleted and new files, by their current content.
		const changed = rel.length
			? (git(top, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...rel]) ?? '')
			: '';
		for (const entry of changed.split('\0').filter(Boolean)) {
			const file = entry.slice(3);
			const full = join(top, file);
			hash.update(`changed:${entry}\n`);
			if (existsSync(full) && statSync(full).isFile()) hash.update(readFileSync(full));
		}
		// A sibling checkout outside this repository (a package path) is not in this index: walk it.
		for (const path of paths) if (relative(top, path).startsWith('..')) walk(path, hash, path);
	} else {
		for (const path of paths) walk(path, hash, root);
	}
	return hash.digest('hex').slice(0, 16);
}
