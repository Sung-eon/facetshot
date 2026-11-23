/**
 * Talking to the daemon: start it if it isn't there (or runs older code), send a run, stream its progress back.
 * If it can't be reached, the run happens in this process instead, so a daemon problem never blocks a screenshot.
 */
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { closeSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeFolder, loadConfig } from '../config.ts';
import { EXIT, FacetshotError } from '../errors.ts';
import type { CellResult, Manifest } from '../types.ts';
import type { RunRequest } from '../run.ts';
import { SOCKET, type Event, type SessionMessage } from './server.ts';
import type { SessionInfo } from '../session.ts';
import type { LogEntry } from '../logs.ts';
import { codeStamp } from './stamp.ts';
import { openLog, waitUntil } from '../engine/procs.ts';

interface Status {
	pid: number;
	stamp: string;
	active: number;
	/** Sessions open: like runs, they would be lost if the daemon were replaced. */
	sessions?: number;
	/** Closing what it holds; it goes once that is done, and a new daemon starts after it. */
	stopping?: boolean;
	idleMinutes: number;
	/** The shared browsers that are running. */
	browsers?: string[];
	projects: { root: string; running: number; open: string[] }[];
}

function call(
	method: string,
	path: string,
	body?: unknown,
	timeout = 3000
): Promise<{ status: number; text: string }> {
	return new Promise((done, fail) => {
		const req = httpRequest(
			{
				socketPath: SOCKET(),
				method,
				path,
				timeout,
				headers: { 'Content-Type': 'application/json' }
			},
			(response) => {
				let text = '';
				response.setEncoding('utf8');
				response.on('data', (chunk) => (text += chunk));
				response.on('end', () => done({ status: response.statusCode ?? 0, text }));
			}
		);
		req.on('error', fail);
		req.on('timeout', () => req.destroy(new Error('timed out')));
		if (body !== undefined) req.write(JSON.stringify(body));
		req.end();
	});
}

export async function status(): Promise<Status | undefined> {
	if (!existsSync(SOCKET())) return undefined;
	try {
		const { text } = await call('GET', '/status');
		return JSON.parse(text) as Status;
	} catch {
		return undefined;
	}
}

async function startDaemon(): Promise<void> {
	const log = openLog(join(homeFolder(), 'daemon.log'));
	const cli = fileURLToPath(new URL('../cli.ts', import.meta.url));
	const child = spawn(
		process.execPath,
		[...(process.versions.bun ? ['--bun'] : []), cli, 'daemon', 'serve'],
		{
			detached: true,
			stdio: ['ignore', log, log],
			env: process.env
		}
	);
	closeSync(log);
	child.unref();
	if (await waitUntil(async () => !!(await status()), 10_000)) return;
	throw new Error(`The daemon didn't start; see ${join(homeFolder(), 'daemon.log')}.`);
}

/**
 * How long a client waits for a helper running other code to finish what it is doing, so it can be replaced. Running
 * in the client's own process instead would start a second set of browsers and simulators outside the machine's caps.
 */
const REPLACE_WAIT_MS = 5 * 60_000;

const busy = (current: Status) => current.active > 0 || (current.sessions ?? 0) > 0;

/** A daemon running this code, started if need be. Undefined if that can't be had right now. */
async function ensureDaemon(log: (message: string) => void): Promise<boolean> {
	const stamp = codeStamp();
	let current = await status();
	if (current && current.stamp !== stamp && !current.stopping) {
		if (busy(current)) {
			log(
				'The background helper is busy with other facetshot code; waiting for it to finish, so this run shares its browsers and limits…'
			);
			const freed = await waitUntil(
				async () => {
					current = await status();
					return !current || !!current.stopping || !busy(current);
				},
				REPLACE_WAIT_MS,
				{ every: 2000 }
			);
			if (!freed) {
				log(
					`The background helper is still busy after ${REPLACE_WAIT_MS / 60_000} minutes; running this one here instead.`
				);
				return false;
			}
		}
		if (current && !current.stopping) {
			await call('POST', '/stop').catch(() => {});
			current = { ...current, stopping: true };
		}
	}
	if (current?.stopping) {
		// It is closing what it holds; a new one started now would borrow servers it is about to stop.
		log('The background helper is stopping; waiting for it to finish…');
		if (!(await waitUntil(async () => !(await status()), 70_000, { every: 250 }))) return false;
		current = undefined;
	}
	if (!current) await startDaemon();
	return true;
}

export interface ClientOptions {
	configFile?: string;
	cwd: string;
	log: (message: string) => void;
	onCell: (result: CellResult, done: number, total: number) => void;
}

export async function runViaDaemon(request: RunRequest, options: ClientOptions): Promise<Manifest> {
	let ok = false;
	try {
		ok = !process.env.FACETSHOT_NO_DAEMON && (await ensureDaemon(options.log));
	} catch (error) {
		options.log(`${error instanceof Error ? error.message : error} Running here instead.`);
	}
	if (!ok) {
		const { run } = await import('../run.ts');
		const { config } = await loadConfig({ file: options.configFile, cwd: options.cwd });
		return run(request, { config, log: options.log, onCell: options.onCell });
	}
	return new Promise((done, fail) => {
		const req = httpRequest(
			{
				socketPath: SOCKET(),
				method: 'POST',
				path: '/run',
				headers: { 'Content-Type': 'application/json' }
			},
			(response) => {
				let buffer = '';
				let finished = false;
				response.setEncoding('utf8');
				response.on('data', (chunk: string) => {
					buffer += chunk;
					let newline: number;
					while ((newline = buffer.indexOf('\n')) >= 0) {
						const line = buffer.slice(0, newline);
						buffer = buffer.slice(newline + 1);
						if (!line.trim()) continue;
						const event = JSON.parse(line) as Event;
						if (event.type === 'log') options.log(event.message);
						else if (event.type === 'cell')
							options.onCell(event.result as CellResult, event.done, event.total);
						else if (event.type === 'done') {
							finished = true;
							done(event.manifest as Manifest);
						} else if (event.type === 'error') {
							finished = true;
							fail(new FacetshotError(event.message, undefined, event.exitCode));
						}
					}
				});
				response.on('end', () => {
					if (!finished)
						fail(
							new Error(
								'The background helper stopped before the run finished; see ~/.facetshot/daemon.log.'
							)
						);
				});
			}
		);
		req.on('error', fail);
		// Ctrl-C here stops the run there.
		const stop = () => req.destroy();
		process.once('SIGINT', stop);
		// The MCP server sends many runs from one process: don't let listeners pile up.
		req.on('close', () => process.off('SIGINT', stop));
		req.write(
			JSON.stringify({
				request,
				configFile: options.configFile,
				cwd: options.cwd,
				env: process.env
			})
		);
		req.end();
	});
}

export async function daemonCommand(action: string): Promise<number> {
	switch (action) {
		case 'serve': {
			const { serve } = await import('./server.ts');
			await serve();
			return new Promise<number>(() => {});
		}
		case 'status': {
			const current = await status();
			if (!current) {
				process.stdout.write('Not running. It starts by itself with the next screenshot.\n');
				return EXIT.ok;
			}
			process.stdout.write(
				`Running (pid ${current.pid}), ${current.active} run${current.active === 1 ? '' : 's'} now, idle ${current.idleMinutes} min.\n`
			);
			for (const line of current.browsers ?? []) process.stdout.write(`  ${line}\n`);
			for (const project of current.projects) {
				process.stdout.write(
					`  ${project.root}\n${project.open.map((line) => `    ${line}`).join('\n')}\n`
				);
			}
			return EXIT.ok;
		}
		case 'stop': {
			if (!(await status())) {
				process.stdout.write('Not running.\n');
				return EXIT.ok;
			}
			await call('POST', '/stop');
			await waitUntil(async () => !(await status()), 70_000, { every: 250 });
			process.stdout.write(
				'Stopped. Servers, browsers, simulators and test data it held are closed.\n'
			);
			return EXIT.ok;
		}
		default:
			throw new FacetshotError(
				`Unknown daemon action "${action}".`,
				'Use status or stop.',
				EXIT.usage
			);
	}
}

/** Sessions live in the daemon; this asks it, starting one with this code if none is running. */
export async function sessionCall<T>(
	action: 'open' | 'act' | 'look' | 'close',
	body: SessionMessage
): Promise<T> {
	if (process.env.FACETSHOT_NO_DAEMON) {
		throw new FacetshotError(
			'Sessions are kept by the background helper, which FACETSHOT_NO_DAEMON turns off.',
			undefined,
			EXIT.usage
		);
	}
	if (action === 'open') {
		// A helper running other code (another checkout's facetshot, say) may not know sessions: it is replaced when
		// it is free, as for runs; while it is busy, there's nowhere to keep a session.
		if (!(await ensureDaemon(() => {}))) {
			throw new FacetshotError(
				'The background helper is still busy running other facetshot code, which can’t keep this session.',
				'Try again once it’s done (facetshot daemon status shows what it’s doing).',
				EXIT.environment
			);
		}
	} else if (!(await status())) throw noSession(body.id);
	// Opening may build the app and start its servers first.
	const { status: code, text } = await call('POST', `/session/${action}`, body, 20 * 60_000);
	if (code === 404) throw noSession(body.id);
	const answer = JSON.parse(text) as T & { message?: string; exitCode?: number };
	if (code !== 200)
		throw new FacetshotError(answer.message ?? text, undefined, answer.exitCode ?? EXIT.internal);
	return answer;
}

function noSession(id: string | undefined): FacetshotError {
	return new FacetshotError(
		`There's no open session "${id}": the background helper isn't running.`,
		'Open one with facetshot open <target>.',
		EXIT.usage
	);
}

export async function listSessions(): Promise<SessionInfo[]> {
	if (!(await status())) return [];
	return JSON.parse((await call('GET', '/sessions')).text) as SessionInfo[];
}

/** A session's log lines, and with `follow` each new one as it happens, until the session closes or Ctrl-C. */
export function sessionLogs(
	id: string,
	options: { follow?: boolean; onEntry: (entry: LogEntry) => void }
): Promise<void> {
	return new Promise((done, fail) => {
		const req = httpRequest(
			{
				socketPath: SOCKET(),
				method: 'GET',
				path: `/session/logs?id=${encodeURIComponent(id)}&follow=${options.follow ? 1 : 0}`
			},
			(response) => {
				let buffer = '';
				response.setEncoding('utf8');
				response.on('data', (chunk: string) => {
					buffer += chunk;
					let newline: number;
					while ((newline = buffer.indexOf('\n')) >= 0) {
						const line = buffer.slice(0, newline);
						buffer = buffer.slice(newline + 1);
						if (line.trim()) options.onEntry(JSON.parse(line) as LogEntry);
					}
				});
				response.on('end', () => {
					if (response.statusCode !== 200) {
						const answer = JSON.parse(buffer || '{}') as { message?: string };
						fail(new FacetshotError(answer.message ?? 'No such session.', undefined, EXIT.usage));
					} else done();
				});
			}
		);
		req.on('error', (error) =>
			fail((error as NodeJS.ErrnoException).code === 'ENOENT' ? noSession(id) : error)
		);
		const stop = () => {
			req.destroy();
			done();
		};
		process.once('SIGINT', stop);
		req.on('close', () => process.off('SIGINT', stop));
		req.end();
	});
}
