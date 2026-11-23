/**
 * Sessions: a screen kept open so an agent (or a person) can work it step by step — click, scroll, open a context
 * menu, type — and see the screenshot, the logs and what's clickable after each step. The daemon holds them; each is
 * one screen on one device in one variant (a page, an Electron or Tauri window, or a Mac app's window), with the
 * project's servers, sign-in and test data, like a run's.
 */
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { stringify } from 'yaml';
import type { Cell, Config, Finding } from './types.ts';
import { plan } from './plan.ts';
import { loadFlow, type Step } from './flows.ts';
import { newContext, startServices, stateDir } from './run.ts';
import { prepareFixtures } from './fixtures.ts';
import { within } from './engine/procs.ts';
import type { Runtime } from './engine/runtime.ts';
import { UsageError } from './errors.ts';
import type { RunContext } from './drivers/driver.ts';
import { atLeast, LogBook, LogTail, redact, type LogEntry, type LogLevel } from './logs.ts';
import { openSurface, sessionKind, type Surface } from './surface.ts';

/** Sessions open at once on the machine: each is a page with its own memory. */
export const MAX_SESSIONS = 6;
export const SESSION_IDLE_MS = Number(process.env.FACETSHOT_SESSION_IDLE_MINUTES ?? 10) * 60_000;

export interface OpenRequest {
	target: string;
	/** One device (default: the first of the default profile's). */
	on?: string;
	/** One variant (default: the first of the default profile's). */
	as?: string;
	/** What the first answer shows, as for `look`. */
	look?: LookOptions;
}

export interface LookOptions {
	/** List what on screen can be clicked or typed into, each with a ref (`e12`) for the next step. */
	elements?: boolean;
	/** The page's whole accessibility tree as text: everything it says, not only what's clickable. */
	tree?: boolean;
	/** Take a screenshot (default true). Without one, an answer is text only, and cheap. */
	picture?: boolean;
	/** The whole page rather than what's on screen. */
	full?: boolean;
	/** The least important log lines to return (default `info`). */
	logLevel?: LogLevel;
}

export interface OnScreen {
	/** Playwright's ref from the page's accessibility snapshot: `e12`, or `f1e3` inside a frame. */
	ref: string;
	role: string;
	name: string;
	/** Its box on the screenshot, in CSS pixels. */
	x: number;
	y: number;
	width: number;
	height: number;
	/** Flags from the snapshot: `checked`, `disabled`, `expanded`, `selected`, `pressed`… */
	states?: string[];
	value?: string;
}

/** What a session shows after opening, a step, or a look. */
export interface View {
	session: string;
	url: string;
	title: string;
	device: string;
	variant: string;
	/** The screenshot (`@x,y` in a step is a point on it, in `units`); none when `picture: false`. */
	image?: string;
	/** CSS pixels for a page, points for a Mac window. */
	units?: 'CSS pixels' | 'points';
	width?: number;
	height?: number;
	/** Log lines since the last view. */
	logs: LogEntry[];
	/** Console errors and failed requests since the last view. */
	findings: Finding[];
	elements?: OnScreen[];
	/** The accessibility tree, when asked for. */
	tree?: string;
	/** The step that failed, if one did; the steps before it were done and the view shows where it stopped. */
	failed?: { step: number; error: string };
	/** Not settled in time: still waiting for this. */
	unsettled?: string;
}

export interface SessionInfo {
	id: string;
	root: string;
	/** Where its screenshots are written; deleted when it closes, unless they are kept (`keepSession`). */
	folder: string;
	url: string;
	device: string;
	variant: string;
	steps: number;
	idleSeconds: number;
}

export class Session {
	readonly started = Date.now();
	lastUsed = Date.now();
	/** Steps that worked, to save as a flow. */
	readonly steps: Step[] = [];
	readonly servers = new LogBook(5000);
	private cursor = 0;
	private serverCursor = 0;
	private views = 0;
	private closers: (() => Promise<void>)[] = [];
	private tail: LogTail;
	private busy: Promise<unknown> = Promise.resolve();
	surface: Surface | undefined;
	start = '/';

	constructor(
		readonly id: string,
		readonly root: string,
		ctx: RunContext,
		readonly folder: string
	) {
		this.tail = new LogTail(join(ctx.stateDir, 'logs'));
	}

	get log(): LogBook {
		return this.screen.log;
	}

	private get screen(): Surface {
		if (!this.surface) throw new Error(`Session ${this.id} has no screen open.`);
		return this.surface;
	}

	/** One thing at a time per session: two agents' steps on one screen would be anyone's guess. */
	private serial<T>(work: () => Promise<T>): Promise<T> {
		const next = this.busy.then(work, work);
		this.busy = next.catch(() => {});
		this.lastUsed = Date.now();
		return next.finally(() => (this.lastUsed = Date.now()));
	}

	static async open(
		request: OpenRequest,
		config: Config,
		runtime: Runtime,
		pools: RunContext['pools'] | undefined,
		log: (message: string) => void
	): Promise<{ session: Session; view: View }> {
		const planned = plan(
			{
				targets: [request.target],
				on: request.on ? [request.on] : undefined,
				as: request.as ? [request.as] : undefined
			},
			config
		);
		const cell = planned.cells.find((each: Cell) => sessionKind(each, config));
		if (!cell) {
			throw new UsageError(
				planned.unmatched[0] ??
					`A session can't open "${request.target}" on ${request.on ?? 'the default device'}.`,
				'Give a path (/settings) or a full URL with a web device (--on phone), or app:/path with a window device for a desktop app. iOS simulators and Storybook stories take flows for now.'
			);
		}
		const id = `s-${randomBytes(3).toString('hex')}`;
		const folder = join(stateDir(config), 'sessions', id);
		mkdirSync(folder, { recursive: true });
		const closers: (() => Promise<void>)[] = [];
		const ctx = newContext(config, {
			runId: id,
			runDir: folder,
			checks: ['console', 'network'],
			images: true,
			runtime,
			pools,
			log,
			signal: new AbortController().signal,
			atEnd: (close) => void closers.push(close)
		});
		const session = new Session(id, config.root ?? process.cwd(), ctx, folder);
		session.closers = closers;
		try {
			await startServices(ctx);
			Object.assign(ctx.values, await prepareFixtures(ctx));
			const surface = await openSurface(cell, ctx, runtime, closers);
			session.surface = surface;
			session.start = cell.target.value;
			// The servers' log starts here: building and starting them is setup, not something the screen did.
			session.tail = new LogTail(join(ctx.stateDir, 'logs'));
			const view = await surface.guard(async () => {
				await surface.open(session.start);
				return session.view({ elements: true, ...request.look });
			});
			return { session, view };
		} catch (error) {
			await session.close();
			throw error;
		}
	}

	/** Does the steps in order, stopping at the first that fails, then shows where the screen is. */
	act(steps: Step[], options: LookOptions = {}): Promise<View> {
		return this.serial(() =>
			this.screen.guard(async () => {
				let failed: View['failed'];
				for (const [index, step] of steps.entries()) {
					if ('shot' in step) continue;
					try {
						this.steps.push(await this.screen.step(step));
					} catch (error) {
						failed = {
							step: index + 1,
							error: `${JSON.stringify(step)}: ${error instanceof Error ? error.message.split('\n')[0] : error}`
						};
						break;
					}
				}
				const view = await this.view(options);
				return failed ? { ...view, failed } : view;
			})
		);
	}

	look(options: LookOptions = {}): Promise<View> {
		return this.serial(() => this.screen.guard(() => this.view(options)));
	}

	/** Log lines after a position, with the servers' new lines. */
	logsSince(cursor: number): LogEntry[] {
		return this.log.since(cursor);
	}

	/** Reads the servers' logs into `servers`: called while someone follows the session. */
	pollServers(): void {
		this.tail.read(this.servers);
	}

	private async view(options: LookOptions): Promise<View> {
		const screen = this.screen;
		let image: string | undefined;
		if (options.picture !== false) {
			this.views += 1;
			image = join(this.folder, `${String(this.views).padStart(3, '0')}.png`);
		}
		const look = await screen.look(options, image);
		this.pollServers();
		const level = options.logLevel ?? 'info';
		const logs = atLeast(
			[...this.log.since(this.cursor), ...this.servers.since(this.serverCursor)].sort(
				(a, b) => a.at - b.at
			),
			level
		);
		this.cursor = this.log.cursor;
		this.serverCursor = this.servers.cursor;
		return {
			session: this.id,
			url: redact(screen.url()),
			title: await screen.title(),
			device: screen.device.name,
			variant: screen.variant.name,
			...look,
			units: screen.units,
			logs
		};
	}

	info(): SessionInfo {
		return {
			id: this.id,
			root: this.root,
			folder: this.folder,
			url: redact(this.surface?.url() ?? ''),
			device: this.surface?.device.name ?? '',
			variant: this.surface?.variant.name ?? '',
			steps: this.steps.length,
			idleSeconds: Math.round((Date.now() - this.lastUsed) / 1000)
		};
	}

	/** The steps that worked, as a flow file that `facetshot <file>` plays again. */
	saveFlow(file: string): string {
		if (!/\.(ya?ml|json)$/.test(file))
			throw new UsageError(
				`"${file}" isn't a flow file name.`,
				'Give a .yaml, .yml or .json path, e.g. flows/edit-settings.yaml.'
			);
		const path = resolve(this.root, file);
		// A flow belongs to the project: a name that climbs out of it (../, an absolute path elsewhere, or a folder
		// that links elsewhere) is refused.
		const root = realpathSync(this.root);
		let folder = dirname(path);
		while (!existsSync(folder)) folder = dirname(folder);
		const inside = relative(root, join(realpathSync(folder), relative(folder, path)));
		if (!inside || inside.startsWith('..') || isAbsolute(inside)) {
			throw new UsageError(
				`A flow is saved inside the project (${this.root}); "${file}" is outside it.`,
				'Give a path in the project, e.g. flows/edit-settings.yaml.'
			);
		}
		// Another flow may be replaced; any other file in the project may not.
		if (existsSync(path)) {
			try {
				loadFlow(path, this.root);
			} catch {
				throw new UsageError(
					`${file} already exists and isn't a flow, so it was left alone.`,
					'Choose another name, e.g. flows/edit-settings.yaml.'
				);
			}
		}
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, stringify({ start: this.start, steps: [...this.steps, { shot: 'end' }] }));
		return path;
	}

	/** Closes the screen and lets go of what the session started (test data goes with the project's runtime). */
	async close(): Promise<void> {
		for (const close of this.closers.reverse()) await within(close(), 10_000);
		this.closers = [];
		rmSync(this.folder, { recursive: true, force: true });
	}
}

/** A view as text: where, what happened, what's clickable. Shared by the CLI and the MCP server. */
export function describeView(view: View): string {
	const lines = [
		`${view.session} · ${view.device}/${view.variant} · ${view.url}${view.title ? ` · "${view.title}"` : ''}`
	];
	if (view.failed) lines.push(`✗ Step ${view.failed.step} didn't work: ${view.failed.error}`);
	if (view.unsettled) lines.push(`! Not settled after 8s: still waiting for ${view.unsettled}.`);
	if (view.image)
		lines.push(
			`Screenshot: ${view.image} (${view.width}×${view.height}, ${view.units ?? 'CSS pixels'})`
		);
	for (const finding of view.findings)
		lines.push(`${finding.severity === 'error' ? '✗' : '!'} ${finding.check}: ${finding.message}`);
	if (view.logs.length) {
		lines.push('', `Logs (${view.logs.length}):`);
		const origin = view.logs[0].at;
		for (const entry of view.logs.slice(-40))
			lines.push(
				`  +${((entry.at - origin) / 1000).toFixed(2)}s ${entry.level.toUpperCase().padEnd(5)} ${entry.source} ${entry.text}`
			);
		if (view.logs.length > 40) lines.push(`  …${view.logs.length - 40} earlier lines left out`);
	}
	if (view.elements?.length) {
		lines.push(
			'',
			`On screen (${view.elements.length}; name one by its ref in a step, e.g. click:${view.elements[0].ref}):`
		);
		for (const element of view.elements) {
			const extra = [...(element.states ?? []), element.value !== undefined && `"${element.value}"`]
				.filter(Boolean)
				.join(', ');
			lines.push(
				`  ${element.ref} ${element.role}${element.name ? ` "${element.name}"` : ''} @${element.x + Math.round(element.width / 2)},${element.y + Math.round(element.height / 2)}${extra ? ` (${extra})` : ''}`
			);
		}
	}
	if (view.tree) lines.push('', 'Page:', view.tree);
	return lines.join('\n') + '\n';
}
