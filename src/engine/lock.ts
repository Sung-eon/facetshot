/**
 * Machine-wide locks: a folder made with mkdir (atomic everywhere), holding a note of who took it.
 *
 * The folder form is deliberate: it is what shell scripts can take too (`mkdir x.lock || wait`), so facetshot and a
 * team's existing scripts can share one lock. A lock whose owner process is gone is taken over, so a crash never
 * leaves the machine stuck.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { alive, sleep } from './procs.ts';

export interface LockOwner {
	pid: number;
	host: string;
	what: string;
	since: string;
}

function owner(path: string): LockOwner | undefined {
	try {
		return JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8')) as LockOwner;
	} catch {
		return undefined;
	}
}

/** Tries once. Returns a release function, or undefined if someone else holds it. */
export function tryLock(path: string, what: string): (() => void) | undefined {
	try {
		mkdirSync(path, { recursive: false });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			mkdirSync(join(path, '..'), { recursive: true });
			return tryLock(path, what);
		}
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
		const held = owner(path);
		// Taken by a process that is gone: take it over. A lock without a note (a shell script's) is respected.
		if (held && held.host === hostname() && !alive(held.pid)) {
			rmSync(path, { recursive: true, force: true });
			return tryLock(path, what);
		}
		return undefined;
	}
	const note: LockOwner = {
		pid: process.pid,
		host: hostname(),
		what,
		since: new Date().toISOString()
	};
	writeFileSync(join(path, 'owner.json'), JSON.stringify(note));
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const held = owner(path);
		if (!held || held.pid === process.pid) rmSync(path, { recursive: true, force: true });
	};
}

/** Waits for the lock, telling `onWait` who holds it (once, then every minute). */
export async function lock(
	path: string,
	what: string,
	options: {
		poll?: number;
		timeout?: number;
		onWait?: (message: string) => void;
		signal?: AbortSignal;
	} = {}
): Promise<() => void> {
	const poll = options.poll ?? 2000;
	const started = Date.now();
	let told = 0;
	for (;;) {
		const release = tryLock(path, what);
		if (release) return release;
		options.signal?.throwIfAborted();
		if (options.timeout && Date.now() - started > options.timeout) {
			const held = owner(path);
			throw new Error(
				`Gave up waiting for ${path}${held ? ` (held by pid ${held.pid} for ${held.what} since ${held.since})` : ''}.`
			);
		}
		if (Date.now() - told > 60_000) {
			const held = owner(path);
			options.onWait?.(
				`Waiting for ${path}${held ? `, held by ${held.what} (pid ${held.pid})` : ''}…`
			);
			told = Date.now();
		}
		await sleep(poll);
	}
}

export async function withLock<T>(
	path: string,
	what: string,
	work: () => Promise<T>,
	options?: Parameters<typeof lock>[2]
): Promise<T> {
	const release = await lock(path, what, options);
	try {
		return await work();
	} finally {
		release();
	}
}
