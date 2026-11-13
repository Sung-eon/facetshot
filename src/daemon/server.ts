/**
 * The daemon: one process per machine that keeps browsers, servers, simulators and test data warm between runs, and
 * puts every run — from any terminal, agent or MCP client — through the same caps, so ten agents taking screenshots at
 * once still open one browser and at most two simulators.
 *
 * It listens on a Unix socket in ~/.facetshot, speaks HTTP over it (one JSON request in, a stream of JSON lines
 * out), and exits by itself after a quiet spell.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect } from 'node:net';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homeFolder, loadConfig } from '../config.ts';
import { Runtime } from '../engine/runtime.ts';
import { Pool } from '../engine/scheduler.ts';
import { explain, FacetshotError } from '../errors.ts';
import { run, type RunRequest } from '../run.ts';
import { codeStamp } from './stamp.ts';
import {
	MAX_SESSIONS,
	Session,
	SESSION_IDLE_MS,
	type LookOptions,
	type OpenRequest
} from '../session.ts';
import type { Step } from '../flows.ts';

export const SOCKET = () => join(homeFolder(), 'daemon.sock');
const PID_FILE = () => join(homeFolder(), 'daemon.pid');
export const IDLE_MS = Number(process.env.FACETSHOT_IDLE_MINUTES ?? 15) * 60_000;
/** The daemon's own memory ceiling; browsers are separate processes and are recycled on their own (below). */
const MAX_RSS = 1.5 * 2 ** 30;
/** Runs after which a project's browsers are closed and started fresh, so a long-lived browser can't keep growing. */
const RUNS_PER_BROWSER = 25;
/** However closing goes, the daemon is gone this long after it starts to stop; what it started dies with it. */
const SHUTDOWN_DEADLINE_MS = 60_000;
/** A request body is a small JSON run request; anything bigger is a mistake, not something to hold in memory. */
const MAX_BODY = 1 * 2 ** 20;

/** A session request: open one (with the client's config, like a run), or work one by its id. */
export interface SessionMessage {
	open?: OpenRequest;
	configFile?: string;
	cwd?: string;
	env?: Record<string, string | undefined>;
	id?: string;
	steps?: Step[];
	options?: LookOptions;
	/** On close: save the steps that worked as a flow file here. */
	save?: string;
}

export interface RunMessage {
	request: RunRequest;
	configFile?: string;
	cwd: string;
	/** The client's environment: the config is read in it (which database, which ports). */
	env?: Record<string, string | undefined>;
}

/** A line of the stream a run answers with. */
export type Event =
	| { type: 'log'; message: string }
	| { type: 'cell'; result: unknown; done: number; total: number }
	| { type: 'done'; manifest: unknown }
	| { type: 'error'; message: string; exitCode: number };

interface Project {
	root: string;
	runtime: Runtime;
	/** The config's modification time: a changed config gets a fresh runtime. */
	/** The config's file and environment (`LoadedConfig.stamp`): either changing means a fresh runtime. */
	stamp: string;
	running: number;
	runs: number;
	lastUsed: number;
}

/** Whether something answers on the socket: a daemon that is alive, as opposed to a file a dead one left. */
export function answers(socket: string): Promise<boolean> {
	return new Promise((done) => {
		const probe = connect(socket);
		const end = (alive: boolean) => {
			probe.destroy();
			done(alive);
		};
		probe.setTimeout(2000, () => end(false));
		probe.once('connect', () => end(true));
		probe.once('error', () => end(false));
	});
}

export async function serve(): Promise<void> {
	const folder = homeFolder();
	mkdirSync(folder, { recursive: true });
	const socket = SOCKET();
	// Never take the socket from a daemon that is alive: it would go on running, unreachable, holding servers and
	// test data. Only a socket nothing answers on (left by a daemon that died) is removed.
	if (existsSync(socket)) {
		if (await answers(socket)) {
			process.stderr.write(
				`facetshot daemon: another one already answers on ${socket}; leaving it be.\n`
			);
			process.exit(0);
		}
		rmSync(socket, { force: true });
	}

	const stamp = codeStamp();
	const projects = new Map<string, Project>();
	/** Every runtime that may hold something open, including one replaced while a run still used it. */
	const runtimes = new Set<Runtime>();
	// Machine-wide: every run, of every project, shares these.
	const pools = { web: new Pool(4), simulators: new Pool(2) };
	let active = 0;
	let lastUsed = Date.now();
	const sessions = new Map<string, { session: Session; project: Project }>();
	let stopping = false;
	/** The socket file this process made, so it only ever removes its own and never a newer daemon's. */
	let mine: number | undefined;

	const retire = async (each: Project) => {
		runtimes.delete(each.runtime);
		await each.runtime.close();
	};

	const project = async (root: string, stamp: string): Promise<Project> => {
		const known = projects.get(root);
		if (known && known.stamp === stamp) return known;
		// A changed config gets a fresh runtime; the old one closes as soon as no run uses it (in handleRun).
		if (known && known.running === 0) await retire(known);
		const fresh: Project = {
			root,
			runtime: new Runtime(),
			stamp,
			running: 0,
			runs: 0,
			lastUsed: Date.now()
		};
		runtimes.add(fresh.runtime);
		projects.set(root, fresh);
		return fresh;
	};

	const releaseSocket = () => {
		try {
			if (mine !== undefined && statSync(socket).ino === mine) rmSync(socket, { force: true });
		} catch {
			// Gone already.
		}
		try {
			if (readFileSync(PID_FILE(), 'utf8').trim() === String(process.pid)) rmSync(PID_FILE());
		} catch {
			// Not ours, or gone.
		}
	};

	const shutdown = async (reason: string) => {
		if (stopping) return;
		stopping = true;
		process.stderr.write(`facetshot daemon stopping: ${reason}\n`);
		// Whatever hangs below, the process ends; the servers and apps it started are killed as it exits.
		setTimeout(() => {
			process.stderr.write('facetshot daemon: closing took too long; killing what is left.\n');
			releaseSocket();
			process.exit(1);
		}, SHUTDOWN_DEADLINE_MS);
		// The socket stays until everything is closed: a client that finds this daemon stopping waits for it to go
		// before it starts the next, so the next never borrows a server this one is about to stop.
		await Promise.all([...sessions.values()].map(({ session }) => session.close().catch(() => {})));
		sessions.clear();
		await Promise.all([...runtimes].map((runtime) => runtime.close()));
		// No `server.close()`: closing a Unix-socket server unlinks the socket by its path, which may be a newer
		// daemon's by now. The socket file goes only through releaseSocket, which checks it is this one's.
		releaseSocket();
		process.exit(0);
	};

	/** Stops once no run is in flight: running work finishes first. */
	let pendingStop: string | undefined;
	const stopWhenIdle = (reason: string) => {
		if (active === 0) void shutdown(reason);
		else pendingStop = reason;
	};

	const handleRun = async (body: RunMessage, response: ServerResponse) => {
		response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
		const send = (event: Event) => response.write(`${JSON.stringify(event)}\n`);
		const controller = new AbortController();
		response.once('close', () => {
			if (!response.writableFinished) controller.abort(new Error('The client went away.'));
		});
		active += 1;
		let entry: Project | undefined;
		try {
			const loaded = await loadConfig({ file: body.configFile, cwd: body.cwd, env: body.env });
			entry = await project(loaded.root, loaded.stamp);
			entry.running += 1;
			const limits = loaded.config.limits ?? {};
			const manifest = await run(body.request, {
				config: loaded.config,
				runtime: entry.runtime,
				// A project's own limits narrow the machine's caps; they never add to them.
				pools: {
					web: limits.webPages ? pools.web.narrow(limits.webPages) : pools.web,
					simulators: limits.simulators
						? pools.simulators.narrow(limits.simulators)
						: pools.simulators
				},
				log: (message) => {
					// Also into the daemon's own log: messages from closing (test data, servers) outlive the client.
					process.stderr.write(`${new Date().toISOString()} ${message}\n`);
					send({ type: 'log', message });
				},
				onCell: (result, done, total) => send({ type: 'cell', result, done, total }),
				signal: controller.signal
			});
			send({ type: 'done', manifest });
		} catch (error) {
			send({
				type: 'error',
				message: explain(error),
				exitCode: error instanceof FacetshotError ? error.exitCode : 4
			});
		} finally {
			response.end();
			if (entry) {
				entry.running -= 1;
				entry.runs += 1;
				entry.lastUsed = Date.now();
				if (entry.running === 0) {
					if (projects.get(entry.root) !== entry) await retire(entry);
					else if (entry.runs % RUNS_PER_BROWSER === 0 && !(await entry.runtime.closeBrowsers()))
						pendingStop ??= "a browser wouldn't close";
				}
			}
			active -= 1;
			lastUsed = Date.now();
			if (pendingStop) stopWhenIdle(pendingStop);
		}
	};

	const endSession = async (id: string) => {
		const held = sessions.get(id);
		if (!held) return;
		sessions.delete(id);
		await held.session.close().catch(() => {});
		held.project.running -= 1;
		held.project.lastUsed = Date.now();
		if (held.project.running === 0 && projects.get(held.project.root) !== held.project)
			await retire(held.project);
	};

	const held = (id: string | undefined) => {
		const found = id ? sessions.get(id) : undefined;
		if (!found) {
			throw new FacetshotError(
				`There's no open session "${id}".`,
				`Sessions close after ${SESSION_IDLE_MS / 60_000} idle minutes. Open another with facetshot open <target>; facetshot list sessions shows the open ones.`,
				2
			);
		}
		return found.session;
	};

	/** Opens, works and closes sessions; answers with JSON. */
	const handleSession = async (action: string, body: SessionMessage) => {
		switch (action) {
			case 'open': {
				if (!body.open) throw new FacetshotError('Nothing to open.', undefined, 2);
				if (sessions.size >= MAX_SESSIONS) {
					throw new FacetshotError(
						`${sessions.size} sessions are open, the most this machine keeps at once.`,
						`Close one first (facetshot close <id>): ${[...sessions.keys()].join(', ')}.`,
						3
					);
				}
				const loaded = await loadConfig({
					file: body.configFile,
					cwd: body.cwd ?? process.cwd(),
					env: body.env
				});
				const entry = await project(loaded.root, loaded.stamp);
				entry.running += 1;
				const limits = loaded.config.limits ?? {};
				try {
					const { session, view } = await Session.open(
						body.open,
						loaded.config,
						entry.runtime,
						{
							web: limits.webPages ? pools.web.narrow(limits.webPages) : pools.web,
							simulators: pools.simulators
						},
						(message) => process.stderr.write(`${new Date().toISOString()} ${message}\n`)
					);
					sessions.set(session.id, { session, project: entry });
					return view;
				} catch (error) {
					entry.running -= 1;
					throw error;
				}
			}
			case 'act':
				return held(body.id).act(body.steps ?? [], body.options);
			case 'look':
				return held(body.id).look(body.options);
			case 'close': {
				const session = held(body.id);
				const saved = body.save ? session.saveFlow(body.save) : undefined;
				await endSession(session.id);
				return { closed: session.id, saved };
			}
			default:
				throw new FacetshotError(`Unknown session action "${action}".`, undefined, 2);
		}
	};

	/** A session's log as it happens: what's there after `cursor`, then each new line, until the client goes. */
	const followLogs = (url: URL, response: ServerResponse) => {
		const session = held(url.searchParams.get('id') ?? undefined);
		response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
		const send = (entry: unknown) => response.write(`${JSON.stringify(entry)}\n`);
		session.pollServers();
		const earlier = [
			...session.logsSince(Number(url.searchParams.get('cursor') ?? 0)),
			...session.servers.since(0)
		].sort((a, b) => a.at - b.at);
		for (const entry of earlier) send(entry);
		if (url.searchParams.get('follow') !== '1') return void response.end();
		const stops = [session.log.subscribe(send), session.servers.subscribe(send)];
		const poll = setInterval(() => {
			if (!sessions.has(session.id)) return void response.end();
			session.pollServers();
		}, 1000);
		response.once('close', () => {
			clearInterval(poll);
			for (const stop of stops) stop();
		});
	};

	const read = (request: IncomingMessage) =>
		new Promise<string>((done, fail) => {
			let text = '';
			request.setEncoding('utf8');
			request.on('data', (chunk: string) => {
				text += chunk;
				if (text.length > MAX_BODY) request.destroy(new Error('The request is too large.'));
			});
			request.once('end', () => done(text));
			request.once('error', fail);
		});

	const server = createServer(async (request, response) => {
		lastUsed = Date.now();
		try {
			if (request.method === 'GET' && request.url === '/status') {
				response.writeHead(200, { 'Content-Type': 'application/json' });
				response.end(
					JSON.stringify({
						pid: process.pid,
						stamp,
						active,
						sessions: sessions.size,
						stopping,
						idleMinutes: Math.round((Date.now() - lastUsed) / 60_000),
						projects: [...projects].map(([root, each]) => ({
							root,
							running: each.running,
							open: each.runtime.describe()
						}))
					})
				);
			} else if (request.method === 'POST' && request.url === '/run' && !stopping) {
				await handleRun(JSON.parse(await read(request)) as RunMessage, response);
			} else if (request.method === 'POST' && request.url?.startsWith('/session/') && !stopping) {
				active += 1;
				try {
					const answer = await handleSession(
						request.url.slice('/session/'.length),
						JSON.parse(await read(request)) as SessionMessage
					);
					response.writeHead(200, { 'Content-Type': 'application/json' });
					response.end(JSON.stringify(answer));
				} catch (error) {
					response.writeHead(400, { 'Content-Type': 'application/json' });
					response.end(
						JSON.stringify({
							message: explain(error),
							exitCode: error instanceof FacetshotError ? error.exitCode : 4
						})
					);
				} finally {
					active -= 1;
					lastUsed = Date.now();
				}
			} else if (request.method === 'GET' && request.url === '/sessions') {
				response.writeHead(200, { 'Content-Type': 'application/json' });
				response.end(JSON.stringify([...sessions.values()].map(({ session }) => session.info())));
			} else if (request.method === 'GET' && request.url?.startsWith('/session/logs')) {
				try {
					followLogs(new URL(request.url, 'http://daemon'), response);
				} catch (error) {
					response.writeHead(400, { 'Content-Type': 'application/json' });
					response.end(JSON.stringify({ message: explain(error), exitCode: 2 }));
				}
			} else if (request.method === 'POST' && request.url === '/stop') {
				response.writeHead(200);
				response.end('stopping');
				stopWhenIdle('asked to stop');
			} else {
				response.writeHead(stopping ? 503 : 404);
				response.end();
			}
		} catch (error) {
			if (!response.headersSent) response.writeHead(500);
			response.end(explain(error));
		}
	});

	server.once('error', (error: NodeJS.ErrnoException) => {
		// Another daemon took the socket between the check above and now: it is the one; this one goes quietly.
		process.stderr.write(`facetshot daemon: can't listen on ${socket} (${error.code}); exiting.\n`);
		process.exit(error.code === 'EADDRINUSE' ? 0 : 1);
	});
	server.listen(socket, () => {
		mine = statSync(socket).ino;
		writeFileSync(PID_FILE(), String(process.pid));
		process.stderr.write(`facetshot daemon ${process.pid} listening on ${socket}\n`);
	});
	setInterval(() => {
		if (stopping) return;
		// A session nobody has touched for its idle time closes, so a forgotten one can't hold a page for ever.
		for (const [id, { session }] of sessions)
			if (Date.now() - session.lastUsed > SESSION_IDLE_MS) void endSession(id);
		if (active === 0 && sessions.size === 0 && Date.now() - lastUsed > IDLE_MS)
			void shutdown(`idle for ${IDLE_MS / 60_000} minutes`);
		// A daemon that has grown too big (a leak somewhere, ours or a dependency's) starts over once it is free; the next
		// run starts a fresh one. Servers and test data go with it, so nothing is left holding memory.
		else if (active === 0 && sessions.size === 0 && process.memoryUsage().rss > MAX_RSS)
			void shutdown(`using ${Math.round(process.memoryUsage().rss / 2 ** 20)} MB`);
		// A project nobody has used for the idle time lets go of its servers and browsers, even while another keeps
		// the daemon busy.
		else
			for (const [root, each] of projects)
				if (each.running === 0 && Date.now() - each.lastUsed > IDLE_MS) {
					projects.delete(root);
					void retire(each);
				}
	}, 30_000).unref();
	// Anything unexpected still closes what this process started before it goes.
	process.on('uncaughtException', (error) => {
		process.stderr.write(`uncaught: ${error.stack ?? error}\n`);
		void shutdown('an unexpected error');
	});
	process.on('unhandledRejection', (error) => {
		process.stderr.write(`unhandled: ${error instanceof Error ? error.stack : error}\n`);
	});
	for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
		process.on(signal, () => void shutdown(signal));
}
