/** Finds and loads `facetshot.config.ts` (or .js/.mjs), walking up from the current folder. */
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Config } from './types.ts';
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
		return { config: { root }, root, stamp: 'none' };
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
	const stamp = createHash('sha1')
		.update(
			JSON.stringify(config, (_key, value) => (typeof value === 'function' ? String(value) : value))
		)
		.digest('hex')
		.slice(0, 16);
	return { config: { ...config, root }, file, root, stamp };
}

/** facetshot's own folder for state shared across projects: the daemon socket, locks, caches. */
export function homeFolder(): string {
	return process.env.FACETSHOT_HOME ?? join(homedir(), '.facetshot');
}

export function expandHome(path: string): string {
	return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}
