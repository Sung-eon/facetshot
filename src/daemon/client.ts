/**
 * Talking to the daemon: start it if it isn't there (or runs older code), send a run, stream its progress back.
 * If it can't be reached, the run happens in this process instead, so a daemon problem never blocks a picture.
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
import { SOCKET, type Event } from './server.ts';
import { codeStamp } from './stamp.ts';
import { openLog, waitUntil } from '../engine/procs.ts';

interface Status {
	pid: number;
	stamp: string;
	active: number;
	/** Closing what it holds; it goes once that is done, and a new daemon starts after it. */
	stopping?: boolean;
	idleMinutes: number;
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

/** A daemon running this code, started if need be. Undefined if that can't be had right now. */
async function ensureDaemon(log: (message: string) => void): Promise<boolean> {
	const stamp = codeStamp();
	let current = await status();
	if (current && current.stamp !== stamp && !current.stopping) {
		if (current.active > 0) {
			log('The background helper is busy with older code; running this one here instead.');
			return false;
		}
		await call('POST', '/stop').catch(() => {});
		current = { ...current, stopping: true };
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
				process.stdout.write('Not running. It starts by itself with the next picture.\n');
				return EXIT.ok;
			}
			process.stdout.write(
				`Running (pid ${current.pid}), ${current.active} run${current.active === 1 ? '' : 's'} now, idle ${current.idleMinutes} min.\n`
			);
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
