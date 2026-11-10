/**
 * Starting and stopping the things pictures need: servers and builds.
 *
 * Every process facetshot starts runs in its own process group with its output in a log file, so it can be stopped
 * as a whole and, when it fails, the last lines of its log say why.
 */
import {
	execFile,
	spawn,
	type ChildProcess,
	type SpawnOptions as NodeSpawnOptions
} from 'node:child_process';
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import type { Command, Service } from '../types.ts';
import { EnvironmentError } from '../errors.ts';
import { fill } from '../plan.ts';

export { sleep };
export const exec = promisify(execFile);

/**
 * Polls `condition` every `every` ms until it holds or `timeout` ms have passed; true if it held. The one wait loop
 * for files, windows, sockets and processes, so none of them can spin without a deadline.
 */
export async function waitUntil(
	condition: () => boolean | Promise<boolean>,
	timeout: number,
	options: { every?: number; signal?: AbortSignal } = {}
): Promise<boolean> {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (await condition()) return true;
		options.signal?.throwIfAborted();
		await sleep(options.every ?? 100);
	}
	return condition();
}

/** Waits for `work` at most `ms`; true if it settled (resolved or rejected) in time. A closing step that hangs must not stop the next one. */
export async function within(work: Promise<unknown>, ms: number): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<false>((done) => (timer = setTimeout(() => done(false), ms)));
	try {
		return await Promise.race([
			work.then(
				() => true,
				() => true
			),
			late
		]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Process groups this process started and hasn't stopped yet. However this process ends (a hard deadline, an
 * uncaught error, `process.exit` anywhere), they are killed with it, so no server outlives the facetshot that started it.
 */
const groups = new Set<number>();
process.on('exit', () => {
	for (const pid of groups) signalGroup(pid, 'SIGKILL');
});

/** Remembers a process group to kill on exit, until it ends or is stopped. */
export function track(pid: number | undefined, child?: ChildProcess): void {
	if (!pid) return;
	groups.add(pid);
	child?.once('exit', () => groups.delete(pid));
}

/** Starts a program in its own process group, tracked so it is killed if facetshot goes. */
export function spawnGroup(
	file: string,
	args: string[],
	options: NodeSpawnOptions = {}
): ChildProcess {
	const child = spawn(file, args, { stdio: 'ignore', ...options, detached: true });
	// A started app or server must not keep facetshot's own process alive; it is stopped explicitly instead.
	child.unref();
	track(child.pid, child);
	return child;
}

function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
	for (const target of [-pid, pid]) {
		try {
			process.kill(target, signal);
			return true;
		} catch {
			// try the next
		}
	}
	return false;
}

/** Whether the process group (or, failing that, the process) is still there. */
const groupAlive = (pid: number) => signalGroup(pid, 0);

/** Whether a process is still there (one of another user's counts: it is there, just not ours to signal). */
export function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

/** Stops a process group: politely, then not. */
export async function stopGroup(pid: number | undefined, grace = 5000): Promise<void> {
	if (!pid) return;
	groups.delete(pid);
	if (!signalGroup(pid, 'SIGTERM')) return;
	const gone = await waitUntil(() => !groupAlive(pid), grace);
	if (!gone) signalGroup(pid, 'SIGKILL');
}

export async function freePort(): Promise<number> {
	return new Promise((done, fail) => {
		const server = createServer();
		server.unref();
		server.on('error', fail);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address ? address.port : 0;
			server.close(() => done(port));
		});
	});
}

export async function portBusy(port: number): Promise<boolean> {
	for (const host of ['127.0.0.1', '::1']) {
		const busy = await new Promise<boolean>((done) => {
			const server = createServer();
			server.once('error', (error: NodeJS.ErrnoException) => done(error.code === 'EADDRINUSE'));
			server.listen(port, host, () => server.close(() => done(false)));
		});
		if (busy) return true;
	}
	return false;
}

export async function healthy(url: string, timeout = 2000): Promise<boolean> {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(timeout), redirect: 'manual' });
		// The body isn't wanted; left unread it would hold the connection open.
		await response.body?.cancel().catch(() => {});
		return response.status < 500;
	} catch {
		return false;
	}
}

/** Logs past this size start over: they are appended to run after run, and only their end is ever read. */
const MAX_LOG = 8 * 2 ** 20;

/** Opens a log file to append to (started afresh when it has grown past MAX_LOG). */
export function openLog(file: string): number {
	mkdirSync(dirname(file), { recursive: true });
	const big = existsSync(file) && statSync(file).size > MAX_LOG;
	return openSync(file, big ? 'w' : 'a');
}

/** The last lines of a log, reading only its end: a build log can be hundreds of megabytes. */
export function tail(file: string | undefined, lines = 15): string {
	if (!file || !existsSync(file)) return '';
	const size = statSync(file).size;
	const length = Math.min(size, 64 * 1024);
	const buffer = Buffer.alloc(length);
	const fd = openSync(file, 'r');
	try {
		readSync(fd, buffer, 0, length, size - length);
	} finally {
		closeSync(fd);
	}
	return buffer.toString('utf8').trimEnd().split('\n').slice(-lines).join('\n');
}

export interface Running {
	name: string;
	url: string;
	port?: number;
	/** False when facetshot found it already running and borrowed it. */
	owned: boolean;
	pid?: number;
	stop(): Promise<void>;
}

/** Servers facetshot started, by project, so a later run can stop one an interrupted run left behind. */
interface ServiceRecord {
	pid: number;
	port: number;
	cmd: string;
	/** The facetshot process that started it: while that one lives, the server is its to stop, not ours. */
	owner?: number;
}

function records(file: string): Record<string, ServiceRecord> {
	try {
		return JSON.parse(readFileSync(file, 'utf8')) as Record<string, ServiceRecord>;
	} catch {
		return {};
	}
}

function writeRecord(file: string, name: string, record: ServiceRecord | undefined): void {
	const all = records(file);
	if (record) all[name] = record;
	else delete all[name];
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(all, null, '\t'));
}

export interface SpawnOptions {
	root: string;
	values: Record<string, string>;
	logFile: string;
}

/** Starts a command in its own process group, output to a log file. */
export function launch(command: Command, options: SpawnOptions): ChildProcess {
	const out = openLog(options.logFile);
	const env: Record<string, string> = { ...(process.env as Record<string, string>) };
	for (const [key, value] of Object.entries(command.env ?? {}))
		env[key] = fill(value, options.values);
	const child = spawn(fill(command.cmd, options.values), {
		cwd: resolve(options.root, command.cwd ?? '.'),
		env,
		shell: true,
		detached: true,
		stdio: ['ignore', out, out]
	});
	closeSync(out);
	track(child.pid, child);
	return child;
}

/** Runs a command to the end. Throws with the end of its log if it fails. */
export async function runToEnd(
	command: Command,
	options: SpawnOptions & { what: string; signal?: AbortSignal }
): Promise<void> {
	const child = launch(command, options);
	const abort = () => stopGroup(child.pid);
	options.signal?.addEventListener('abort', abort, { once: true });
	const code = await new Promise<number | null>((done) => {
		child.once('error', () => done(-1));
		child.once('exit', done);
	});
	options.signal?.removeEventListener('abort', abort);
	if (code !== 0) {
		throw new EnvironmentError(
			`${options.what} failed (exit ${code}). The end of its log (${options.logFile}):\n${tail(options.logFile)}`,
			`Run it yourself to see the whole error: (cd ${resolve(options.root, command.cwd ?? '.')} && ${fill(command.cmd, options.values)})`
		);
	}
}

/** Where a project's services write: the folder for logs and the record of what is running. */
export interface ServiceContext {
	root: string;
	stateDir: string;
	values: Record<string, string>;
	log(message: string): void;
}

/**
 * Makes sure a service is up: borrows it if `reuse` (or its own port) already answers, otherwise starts it and waits
 * for its health check. Its log is `<state>/logs/<logName>.log`.
 */
export async function ensureService(
	name: string,
	service: Service,
	ctx: ServiceContext,
	logName = name
): Promise<Running> {
	if (service.reuse && (await healthy(service.reuse))) {
		return { name, url: service.reuse.replace(/\/$/, ''), owned: false, stop: async () => {} };
	}
	const logFile = resolve(ctx.stateDir, 'logs', `${logName}.log`);
	const recordFile = resolve(ctx.stateDir, 'services.json');
	const port =
		service.port === 'auto' || service.port === undefined ? await freePort() : service.port;
	const url = `http://localhost:${port}`;
	const healthUrl = service.health
		? /^https?:/.test(service.health)
			? fill(service.health, { ...ctx.values, port: String(port) })
			: url + service.health
		: url;
	const owned = (pid: number): Running => {
		track(pid);
		return {
			name,
			url,
			port,
			owned: true,
			pid,
			stop: async () => {
				await stopGroup(pid);
				writeRecord(recordFile, name, undefined);
			}
		};
	};
	if (await portBusy(port)) {
		const record = records(recordFile)[name];
		const orphaned =
			record &&
			record.port === port &&
			groupAlive(record.pid) &&
			!(record.owner && record.owner !== process.pid && alive(record.owner));
		if (orphaned && (await healthy(healthUrl))) {
			// Started by an earlier facetshot run that is gone without stopping it: take it over, and stop it as ours.
			writeRecord(recordFile, name, { ...record, owner: process.pid });
			return owned(record.pid);
		}
		if (await healthy(healthUrl)) {
			// Something already answers where this service would be. facetshot treats it as the service (most often
			// it is: an earlier run left it, or the person runs it themselves), and does not stop it afterwards.
			return { name, url, port, owned: false, stop: async () => {} };
		}
		throw new EnvironmentError(
			`Port ${port} (for "${name}") is taken by something that doesn't answer ${healthUrl}.`,
			`Free the port (lsof -nP -iTCP:${port} -sTCP:LISTEN), or set services.${name}.port to another number or "auto".`
		);
	}
	const values = { ...ctx.values, port: String(port), url };
	ctx.log(`Starting ${name} on :${port}…`);
	const child = launch(service, { root: ctx.root, values, logFile });
	// A server must not keep facetshot's own process alive; it is stopped through the runtime instead.
	child.unref();
	let exited: number | null | undefined;
	child.once('exit', (code) => (exited = code));
	child.once('error', () => (exited = -1));
	const timeout = service.startTimeout ?? 120_000;
	const up = await waitUntil(
		async () => exited !== undefined || (await healthy(healthUrl)),
		timeout,
		{
			every: 300
		}
	);
	if (exited !== undefined) {
		throw new EnvironmentError(
			`"${name}" stopped before it was ready (exit ${exited}). The end of its log (${logFile}):\n${tail(logFile)}`,
			`Try the command yourself: ${fill(service.cmd, values)}`
		);
	}
	if (!up) {
		await stopGroup(child.pid);
		throw new EnvironmentError(
			`"${name}" didn't answer ${healthUrl} within ${Math.round(timeout / 1000)} s. The end of its log:\n${tail(logFile)}`,
			`Check the health path, or raise services.${name}.startTimeout.`
		);
	}
	writeRecord(recordFile, name, {
		pid: child.pid!,
		port,
		cmd: fill(service.cmd, values),
		owner: process.pid
	});
	return owned(child.pid!);
}
