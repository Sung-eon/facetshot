/**
 * The things worth keeping between runs: browsers, servers, booted simulators, signed-in sessions.
 *
 * Run from the command line without the daemon, a Runtime lives for one run and closes everything it opened. Inside
 * the daemon it lives until the daemon goes idle, which is what makes the second run fast.
 */
import type { Browser, BrowserType } from 'playwright';
import { EnvironmentError } from '../errors.ts';
import { healthy, within, type Running } from './procs.ts';

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

/** How long one closing step may take before facetshot moves on; a browser or server that hangs dies with the process. */
const CLOSE_STEP_MS = 10_000;
/** Removing test data is a call per item to the project's API and a simulator takes a while to shut down. */
const CLOSER_MS = 30_000;

export class Runtime {
	private browsers = new Map<string, Promise<Browser>>();
	private services = new Map<string, Running & { version?: string }>();
	/** Per key, the service call in progress: two runs asking at once get one server, not two. */
	private starting = new Map<string, Promise<Running>>();
	/** Anything else a driver wants closed with the runtime (simulators, test data). */
	private closers: { name: string; close: () => Promise<void> }[] = [];
	/** Small keyed values drivers want to keep (fixture values, what a simulator has launched). */
	readonly memo = new Map<string, unknown>();

	/**
	 * A browser, started once and kept. `scheme` is for browsers that can't emulate a colour scheme per page (an
	 * installed Firefox over WebDriver BiDi): they get one browser per scheme, set through Firefox's own preferences.
	 */
	async browser(engine: Engine, scheme?: 'light' | 'dark'): Promise<Browser> {
		const perScheme = engine === 'moz-firefox' ? (scheme ?? 'light') : undefined;
		const key = perScheme ? `${engine}:${perScheme}` : engine;
		let browser = this.browsers.get(key);
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
							`Install it once: bunx playwright install ${engine}`
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
						`Try reinstalling it (bunx playwright install ${engine}), or leave ${engine} out of --browser.`
					);
				}
			})();
			this.browsers.set(key, browser);
			const forget = () => {
				if (this.browsers.get(key) === browser) this.browsers.delete(key);
			};
			browser.then((b) => b.once('disconnected', forget), forget);
		}
		return browser;
	}

	/**
	 * A service kept under `key`: started by `start` when there is none, and started again when the kept one has
	 * stopped answering (`health`) or what it serves has changed (`version`, e.g. the hash of the build under it).
	 */
	service(
		key: string,
		start: () => Promise<Running>,
		options: { version?: string; health?: (running: Running) => Promise<boolean> } = {}
	): Promise<Running> {
		const before = this.starting.get(key) ?? Promise.resolve();
		const next = before
			.catch(() => {})
			.then(async () => {
				const kept = this.services.get(key);
				if (kept) {
					const fresh =
						kept.version === options.version &&
						(await (options.health ?? ((each) => healthy(each.url)))(kept));
					if (fresh) return kept;
					this.services.delete(key);
					await kept.stop().catch(() => {});
				}
				const running = { ...(await start()), version: options.version };
				this.services.set(key, running);
				return running;
			});
		this.starting.set(key, next);
		const settle = () => {
			if (this.starting.get(key) === next) this.starting.delete(key);
		};
		next.then(settle, settle);
		return next;
	}

	onClose(name: string, close: () => Promise<void>): void {
		this.closers.push({ name, close });
	}

	/** What is open right now, for `facetshot daemon status`. */
	describe(): string[] {
		return [
			...[...this.browsers.keys()].map((engine) => `browser: ${engine}`),
			...[...this.services.values()].map(
				(service) => `service: ${service.name} ${service.url}${service.owned ? '' : ' (borrowed)'}`
			),
			...this.closers.map((closer) => closer.name)
		];
	}

	/**
	 * Closes the browsers only (they start again on the next screenshot): what a long-lived daemon does now and then.
	 * False when one wouldn't close in time; it then dies with the process, so the caller should end it soon.
	 */
	async closeBrowsers(): Promise<boolean> {
		const open = [...this.browsers.values()];
		this.browsers.clear();
		const closed = await Promise.all(
			open.map(async (pending) => {
				const browser = await pending.catch(() => undefined);
				return !browser || within(browser.close(), CLOSE_STEP_MS);
			})
		);
		return closed.every(Boolean);
	}

	/**
	 * Closes everything, each step bounded so one that hangs can't keep the rest open: closers first (removing test
	 * data may need the project's API; simulators shut down), then the servers this runtime started, then the
	 * browsers last, so a browser that won't close never keeps a server alive. Returns false if a step timed out;
	 * whatever is still running then is killed when the process exits (see `track` in procs.ts).
	 */
	async close(): Promise<boolean> {
		let clean = true;
		for (const closer of this.closers.splice(0).reverse())
			clean = (await within(closer.close(), CLOSER_MS)) && clean;
		const services = [...this.services.values()].filter((service) => service.owned);
		this.services.clear();
		const stopped = await Promise.all(
			services.map((service) => within(service.stop(), CLOSE_STEP_MS))
		);
		clean = stopped.every(Boolean) && clean;
		clean = (await this.closeBrowsers()) && clean;
		this.memo.clear();
		return clean;
	}
}
