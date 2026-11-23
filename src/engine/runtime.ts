/**
 * The things worth keeping between runs: browsers, servers, booted simulators, signed-in sessions.
 *
 * Run from the command line without the daemon, a Runtime lives for one run and closes everything it opened. Inside
 * the daemon it lives until the daemon goes idle, which is what makes the second run fast.
 */
import type { Browser } from 'playwright';
import { Browsers, type Engine } from './browsers.ts';
import { healthy, within, type Running } from './procs.ts';

export type { Engine } from './browsers.ts';

/** How long one closing step may take before facetshot moves on; a browser or server that hangs dies with the process. */
const CLOSE_STEP_MS = 10_000;
/** Removing test data is a call per item to the project's API and a simulator takes a while to shut down. */
const CLOSER_MS = 30_000;

export class Runtime {
	private readonly browsers: Browsers;
	private readonly ownsBrowsers: boolean;
	private services = new Map<string, Running & { version?: string }>();
	/** Per key, the service call in progress: two runs asking at once get one server, not two. */
	private starting = new Map<string, Promise<Running>>();
	/** Anything else a driver wants closed with the runtime (simulators, test data). */
	private closers: { name: string; close: () => Promise<void> }[] = [];
	/** Small keyed values drivers want to keep (fixture values, what a simulator has launched). */
	readonly memo = new Map<string, unknown>();

	/**
	 * @param browsers shared browsers (the background helper's, one set for every project), or undefined for a set
	 *   of its own that this runtime closes with itself
	 */
	constructor(browsers?: Browsers) {
		this.browsers = browsers ?? new Browsers();
		this.ownsBrowsers = !browsers;
	}

	/** A browser, started once and kept (see Browsers). */
	browser(engine: Engine, scheme?: 'light' | 'dark'): Promise<Browser> {
		return this.browsers.browser(engine, scheme);
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
			...(this.ownsBrowsers ? this.browsers.describe() : []),
			...[...this.services.values()].map(
				(service) => `service: ${service.name} ${service.url}${service.owned ? '' : ' (borrowed)'}`
			),
			...this.closers.map((closer) => closer.name)
		];
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
		// Shared browsers belong to the helper, which closes them itself.
		if (this.ownsBrowsers) clean = (await this.browsers.close()) && clean;
		this.memo.clear();
		return clean;
	}
}
