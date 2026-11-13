/**
 * `facetshot setup`: the browsers facetshot needs, installed by facetshot's own Playwright, then `facetshot doctor`.
 *
 * Always facetshot's own copy of Playwright: `bunx playwright` in a folder without facetshot fetches the newest
 * Playwright, whose browser builds may not be the ones facetshot's Playwright starts.
 */
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, UsageError } from './errors.ts';

/** The browsers Playwright downloads. The others (chrome, msedge, moz-firefox) are the apps installed on the machine. */
const DOWNLOADABLE = ['chromium', 'webkit', 'firefox'];

/** The command that installs a browser, for messages that say how to fix a missing one. */
export function setupCommand(browser = 'chromium'): string {
	return browser === 'chromium' ? 'facetshot setup' : `facetshot setup --browser ${browser}`;
}

/** Runs facetshot's own Playwright command line (`playwright install …`, `playwright uninstall`). */
export function playwright(args: string[]): Promise<number> {
	const cli = join(
		dirname(fileURLToPath(import.meta.resolve('playwright/package.json'))),
		'cli.js'
	);
	return new Promise((done, fail) => {
		const child = spawn(process.execPath, ['--bun', cli, ...args], { stdio: 'inherit' });
		child.on('error', fail);
		child.on('exit', (code) => done(code ?? EXIT.internal));
	});
}

/**
 * Where Playwright keeps the browsers it downloads, shared by every Playwright on the machine. Undefined when
 * PLAYWRIGHT_BROWSERS_PATH=0 keeps them inside the installed package, so they go with it.
 */
export function browsersFolder(): string | undefined {
	const set = process.env.PLAYWRIGHT_BROWSERS_PATH;
	if (set === '0') return undefined;
	if (set) return set;
	if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'ms-playwright');
	if (process.platform === 'win32')
		return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright');
	return join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'ms-playwright');
}

export async function setup(options: {
	browsers?: string[];
	configFile?: string;
}): Promise<number> {
	const browsers = ['chromium', ...(options.browsers ?? []).filter((name) => name !== 'chromium')];
	const unknown = browsers.find((name) => !DOWNLOADABLE.includes(name));
	if (unknown)
		throw new UsageError(
			`facetshot setup can't install "${unknown}".`,
			`It installs ${DOWNLOADABLE.join(', ')}; chrome, msedge and moz-firefox are the browsers installed on this machine, used as they are.`
		);
	process.stdout.write(`Installing ${browsers.join(', ')} with facetshot's Playwright…\n`);
	const code = await playwright(['install', ...browsers]);
	if (code !== 0) {
		process.stderr.write("Playwright couldn't install the browsers (its message is above).\n");
		return EXIT.environment;
	}
	process.stdout.write('\nChecking this machine:\n');
	const { doctor } = await import('./doctor.ts');
	return doctor({ configFile: options.configFile });
}
