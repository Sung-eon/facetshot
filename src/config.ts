/** Finds and loads `facetshot.config.ts` (or .js/.mjs), walking up from the current folder. */
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG_KEYS, EACH, type Config, type KeyShape } from './types.ts';
import { UsageError } from './errors.ts';

export const CONFIG_NAMES = ['facetshot.config.ts', 'facetshot.config.mjs', 'facetshot.config.js'];

/** Gives the config its types in an editor; returns it unchanged. */
export function defineConfig(config: Config): Config {
	return config;
}

export function findConfig(from = process.cwd()): string | undefined {
	let folder = resolve(from);
	for (;;) {
		for (const name of CONFIG_NAMES) {
			const file = join(folder, name);
			if (existsSync(file)) return file;
		}
		const parent = dirname(folder);
		if (parent === folder) return undefined;
		folder = parent;
	}
}

export interface LoadedConfig {
	config: Config;
	/** The config file, or undefined when running without one. */
	file?: string;
	root: string;
	/**
	 * What the config came to, as a hash of its values: the same file read in two environments that make no difference
	 * to it has one stamp, and one that picks another database or port has another.
	 */
	stamp: string;
	/** Keys the config has that facetshot doesn't know (most likely misspelt), each with a suggestion. */
	warnings: string[];
}

/** Config modules are read one at a time, each in its caller's environment (see `env` below). */
let reading: Promise<unknown> = Promise.resolve();

/**
 * This process's own environment, as it was when it started. Commands facetshot starts get this, not whatever
 * `process.env` is at that moment: while a caller's config is being read, `process.env` is briefly the caller's.
 */
const OWN_ENVIRONMENT: Readonly<Record<string, string | undefined>> = { ...process.env };
export function ownEnvironment(): Record<string, string> {
	return { ...(OWN_ENVIRONMENT as Record<string, string>) };
}

/**
 * Runs `work` with `process.env` as the caller's. A config is code and reads its environment (which database, which
 * ports); in the daemon, the environment that matters is the one of whoever asked for the run, not the daemon's own.
 */
async function inEnvironment<T>(
	env: Record<string, string | undefined> | undefined,
	work: () => Promise<T>
): Promise<T> {
	if (!env) return work();
	const turn = reading.then(async () => {
		const saved = { ...process.env };
		for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
		Object.assign(process.env, env);
		try {
			return await work();
		} finally {
			for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
			Object.assign(process.env, saved);
		}
	});
	reading = turn.catch(() => {});
	return turn;
}

/** Loads the config. Without a file, facetshot still works on full URLs, with the built-in devices and variants. */
export async function loadConfig(
	options: { file?: string; cwd?: string; env?: Record<string, string | undefined> } = {}
): Promise<LoadedConfig> {
	const file = options.file
		? resolve(options.cwd ?? process.cwd(), options.file)
		: findConfig(options.cwd);
	if (!file) {
		const root = resolve(options.cwd ?? process.cwd());
		return { config: { root }, root, stamp: 'none', warnings: [] };
	}
	if (!existsSync(file)) throw new UsageError(`There's no config at ${file}.`);
	// A config is read again when it changes, or when it is read in a different environment: the query string makes
	// the module system load it anew.
	const environment = options.env
		? createHash('sha1')
				.update(JSON.stringify(Object.entries(options.env).sort(([a], [b]) => a.localeCompare(b))))
				.digest('hex')
				.slice(0, 12)
		: 'own';
	// Bun keys `file://` imports by path alone and would hand back the first read; a plain path keeps the query.
	const version = `?v=${statSync(file).mtimeMs}-${environment}`;
	const url = process.versions.bun ? `${file}${version}` : `${pathToFileURL(file).href}${version}`;
	let loaded: { default?: Config };
	try {
		loaded = await inEnvironment(options.env, () => import(url));
	} catch (error) {
		throw new UsageError(
			`Couldn't load ${file}: ${error instanceof Error ? error.message : String(error)}`,
			'Fix the error above; the file must `export default defineConfig({...})`.'
		);
	}
	const config = loaded.default;
	if (!config || typeof config !== 'object') {
		throw new UsageError(
			`${file} has no default export.`,
			'End it with `export default defineConfig({...})`.'
		);
	}
	const root = dirname(file);
	const warnings = unknownKeys(config).map((each) => `${file}: ${each}`);
	for (const warning of warnings) {
		if (warned.has(warning)) continue;
		warned.add(warning);
		process.stderr.write(`! ${warning}\n`);
	}
	const stamp = createHash('sha1')
		.update(
			JSON.stringify(config, (_key, value) => (typeof value === 'function' ? String(value) : value))
		)
		.digest('hex')
		.slice(0, 16);
	return {
		config: { ...config, root, ...stateInside(root, config.out) },
		file,
		root,
		stamp,
		warnings
	};
}

/** Warnings already printed by this process: a config read again says nothing new. */
const warned = new Set<string>();

/**
 * A config kept in the project's state folder (`.facetshot/facetshot.config.ts`, given with `-c`) would put its
 * state in `.facetshot/.facetshot`: the state folder is the one the config is already in.
 */
function stateInside(root: string, out: string | undefined): { out?: string } {
	const name = out ?? '.facetshot';
	if (name !== '.facetshot') return {};
	const parts = resolve(root).split(sep);
	const at = parts.lastIndexOf(name);
	return at > 0 ? { out: parts.slice(0, at + 1).join(sep) || sep } : {};
}

/**
 * Keys a config has that `Config` doesn't, each as a warning with the nearest known key: a misspelt key would
 * otherwise be ignored without a word. Checked as deep as the shape is fixed (CONFIG_KEYS, next to the types).
 */
export function unknownKeys(config: unknown, shape: KeyShape = CONFIG_KEYS, path = ''): string[] {
	if (shape === true || !config || typeof config !== 'object' || Array.isArray(config)) return [];
	const each = (shape as { [EACH]?: KeyShape })[EACH];
	const warnings: string[] = [];
	for (const [key, value] of Object.entries(config)) {
		const where = path ? `${path}.${key}` : key;
		if (each) {
			warnings.push(...unknownKeys(value, each, where));
			continue;
		}
		if (!Object.hasOwn(shape, key)) {
			const guess = nearest(key, Object.keys(shape));
			warnings.push(
				`unknown key "${where}" is ignored${guess ? ` (did you mean "${path ? `${path}.` : ''}${guess}"?)` : ''}.`
			);
			continue;
		}
		warnings.push(...unknownKeys(value, (shape as Record<string, KeyShape>)[key], where));
	}
	return warnings;
}

/** The known key closest to a misspelt one, if any is close enough to be what was meant. */
function nearest(key: string, known: string[]): string | undefined {
	let best: string | undefined;
	let bestDistance = Infinity;
	for (const each of known) {
		const distance = editDistance(key.toLowerCase(), each.toLowerCase());
		if (distance < bestDistance) [best, bestDistance] = [each, distance];
	}
	return best !== undefined && bestDistance <= Math.max(2, Math.floor(key.length / 3))
		? best
		: undefined;
}

function editDistance(a: string, b: string): number {
	let row = Array.from({ length: b.length + 1 }, (_, index) => index);
	for (let i = 1; i <= a.length; i++) {
		const next = [i];
		for (let j = 1; j <= b.length; j++)
			next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		row = next;
	}
	return row[b.length];
}

/** facetshot's own folder for state shared across projects: the daemon socket, locks, caches. */
export function homeFolder(): string {
	return process.env.FACETSHOT_HOME ?? join(homedir(), '.facetshot');
}

export function expandHome(path: string): string {
	return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}
