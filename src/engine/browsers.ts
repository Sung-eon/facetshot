/**
 * The browsers: one per engine, started on first use and shared by every project the process serves. Each screenshot
 * and session gets a browser context of its own (cookies, storage, viewport), so projects never see each other's
 * state; sharing the browser process is what keeps ten checkouts from running ten Chromiums.
 */
import type { Browser, BrowserType } from 'playwright';
import { EnvironmentError } from '../errors.ts';
import { setupCommand } from '../setup.ts';
import { within } from './procs.ts';

export type Engine = import('../types.ts').BrowserName;

/** Which Playwright launcher, and which installed browser (channel), a browser name means. */
const LAUNCH: Record<
	Engine,
	{ type: 'chromium' | 'webkit' | 'firefox'; channel?: string; app?: string }
> = {
	chromium: { type: 'chromium' },
	webkit: { type: 'webkit' },
	firefox: { type: 'firefox' },
	chrome: { type: 'chromium', channel: 'chrome', app: 'Google Chrome' },
	msedge: { type: 'chromium', channel: 'msedge', app: 'Microsoft Edge' },
	'moz-firefox': { type: 'firefox', channel: 'moz-firefox', app: 'Firefox' }
};

/** How long closing a browser may take before facetshot moves on; one that hangs dies with the process. */
const CLOSE_MS = 10_000;

export class Browsers {
	private open = new Map<string, Promise<Browser>>();

	/**
	 * A browser, started once and kept. `scheme` is for browsers that can't emulate a colour scheme per page (an
	 * installed Firefox over WebDriver BiDi): they get one browser per scheme, set through Firefox's own preferences.
	 */
	async browser(engine: Engine, scheme?: 'light' | 'dark'): Promise<Browser> {
		const perScheme = engine === 'moz-firefox' ? (scheme ?? 'light') : undefined;
		const key = perScheme ? `${engine}:${perScheme}` : engine;
		let browser = this.open.get(key);
		if (!browser) {
			browser = (async () => {
				const playwright = await import('playwright');
				const { type: launcher, channel, app } = LAUNCH[engine];
				const type: BrowserType = playwright[launcher];
				try {
					// facetshot handles signals itself: it stops servers and removes test data before it goes, and
					// Playwright's own handlers would end the process first. Browsers still die with the process.
					return await type.launch({
						channel,
						firefoxUserPrefs: perScheme
							? {
									'layout.css.prefers-color-scheme.content-override': perScheme === 'dark' ? 0 : 1,
									'ui.systemUsesDarkTheme': perScheme === 'dark' ? 1 : 0
								}
							: undefined,
						headless: true,
						handleSIGINT: false,
						handleSIGTERM: false,
						handleSIGHUP: false
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					if (
						app &&
						/not found|isn't installed|Executable doesn't exist|distribution/i.test(message)
					) {
						throw new EnvironmentError(
							`${app} isn't installed on this machine, so "${engine}" can't be used.`,
							`Install ${app}, or use Playwright's own build instead (${launcher}).`
						);
					}
					if (/Executable doesn't exist|browserType.launch/.test(message)) {
						throw new EnvironmentError(
							`Playwright's ${engine} isn't installed.`,
							`Install it once: ${setupCommand(engine)}`
						);
					}
					// What the browser itself said as it gave up, rather than Playwright's general "failed to launch".
					const said = message
						.replace(/\x1b\[[0-9;]*m/g, '')
						.split('\n')
						.map((line) => /\[err\]\s*(.+)$/.exec(line)?.[1]?.trim())
						.filter((line): line is string => !!line && !/headless mode/i.test(line));
					throw new EnvironmentError(
						`${engine} didn't start${said.length ? `: ${said[said.length - 1]}` : '.'}`,
						`Try installing it again (${setupCommand(engine)}), or leave ${engine} out of --browser.`
					);
				}
			})();
			this.open.set(key, browser);
			const forget = () => {
				if (this.open.get(key) === browser) this.open.delete(key);
			};
			browser.then((b) => b.once('disconnected', forget), forget);
		}
		return browser;
	}

	/** Which browsers are running, for `facetshot daemon status`. */
	describe(): string[] {
		return [...this.open.keys()].map((engine) => `browser: ${engine}`);
	}

	/**
	 * Closes every browser (they start again on the next screenshot). False when one wouldn't close in time; it then
	 * dies with the process, so the caller should end it soon.
	 */
	async close(): Promise<boolean> {
		const open = [...this.open.values()];
		this.open.clear();
		const closed = await Promise.all(
			open.map(async (pending) => {
				const browser = await pending.catch(() => undefined);
				return !browser || within(browser.close(), CLOSE_MS);
			})
		);
		return closed.every(Boolean);
	}
}
