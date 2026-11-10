/**
 * Keeps the machine usable while pictures are taken: a cap on how many things run at once, which drops to one while
 * the machine is already overloaded (other builds, other agents) instead of piling more on. It never stops work
 * outright, so a busy machine makes facetshot slower, not stuck.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';

let pressure: { at: number; level: 'normal' | 'warn' | 'critical' } = { at: 0, level: 'normal' };

/**
 * The system's own word on memory, read at most every two seconds: macOS's memory pressure level, or on Linux the
 * share of memory still available. (Free memory alone says little: both systems keep it nearly full of cache.)
 */
export function memoryPressure(): 'normal' | 'warn' | 'critical' {
	if (Date.now() - pressure.at < 2000) return pressure.level;
	let level: 'normal' | 'warn' | 'critical' = 'normal';
	try {
		if (process.platform === 'darwin') {
			const value = Number(
				execFileSync('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { encoding: 'utf8' })
			);
			level = value >= 4 ? 'critical' : value >= 2 ? 'warn' : 'normal';
		} else if (process.platform === 'linux') {
			const info = readFileSync('/proc/meminfo', 'utf8');
			const kb = (name: string) => Number(new RegExp(`${name}:\\s+(\\d+)`).exec(info)?.[1] ?? 0);
			const share = kb('MemAvailable') / kb('MemTotal');
			level = share < 0.05 ? 'critical' : share < 0.12 ? 'warn' : 'normal';
		}
	} catch {
		// Unreadable: assume normal rather than stopping work.
	}
	pressure = { at: Date.now(), level };
	return level;
}

export class Pool {
	private running = 0;
	private waiting: (() => void)[] = [];

	/**
	 * @param size the most at once
	 * @param maxLoad above this many times the core count (1-minute load average), only one runs at a time
	 * @param parent a wider pool whose slot each piece of work also takes (see `narrow`)
	 */
	constructor(
		readonly size: number,
		private maxLoad = 3,
		private parent?: Pool
	) {}

	/** A pool of at most `size` that still counts against this one: a project's own limit inside the machine's. */
	narrow(size: number): Pool {
		return size >= this.size ? this : new Pool(size, this.maxLoad, this);
	}

	/**
	 * How many may run right now: all of them, one at a time while the machine is busy or short of memory, and none
	 * new while memory is critical (unless nothing runs, so work never stops for good).
	 */
	allowed(): number {
		const memory = memoryPressure();
		if (memory === 'critical') return this.running === 0 ? 1 : 0;
		return memory === 'warn' || overloaded(this.maxLoad) ? 1 : this.size;
	}

	private async acquire(signal?: AbortSignal): Promise<void> {
		while (this.running >= this.allowed()) {
			// Woken by a release, or every second to look at the load again.
			await new Promise<void>((done) => {
				const wake = () => {
					clearTimeout(timer);
					done();
				};
				// Whichever comes first; the other is taken back, so a long wait leaves nothing behind.
				const timer = setTimeout(() => {
					this.waiting.splice(this.waiting.indexOf(wake) >>> 0, 1);
					done();
				}, 1000);
				this.waiting.push(wake);
			});
			signal?.throwIfAborted();
		}
		this.running += 1;
	}

	private release(): void {
		this.running -= 1;
		this.waiting.shift()?.();
	}

	async run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
		await this.acquire(signal);
		try {
			return this.parent ? await this.parent.run(work, signal) : await work();
		} finally {
			this.release();
		}
	}

	/** Runs `work` over every item, as many at a time as allowed. */
	async each<T>(items: T[], work: (item: T) => Promise<void>, signal?: AbortSignal): Promise<void> {
		await Promise.all(items.map((item) => this.run(() => work(item), signal)));
	}
}

export function overloaded(factor: number): boolean {
	if (!factor || process.platform === 'win32') return false;
	return loadavg()[0] > factor * cpus().length;
}
