/**
 * Sessions: a screen kept open so an agent (or a person) can work it step by step — click, scroll, open a context
 * menu, type — and see the screenshot, the page's logs and what's clickable after each step. The daemon holds them; each
 * is one page on one device in one variant, with the project's servers, sign-in and test data, like a run's.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { stringify } from 'yaml';
import type { Config, Finding } from './types.ts';
import { plan } from './plan.ts';
import { doStep, type Step } from './flows.ts';
import { newContext, startServices, stateDir } from './run.ts';
import { prepareFixtures } from './fixtures.ts';
import { within } from './engine/procs.ts';
import type { Runtime } from './engine/runtime.ts';
import { UsageError } from './errors.ts';
import { fillAddress, type RunContext } from './drivers/driver.ts';
import { engineOf, navigate, newSession, WebDriver, type PageSession } from './drivers/web.ts';
import { readPage, readyRuleFor, waitReady } from './drivers/page.ts';
import { atLeast, LogBook, LogTail, redact, type LogEntry, type LogLevel } from './logs.ts';

/** Sessions open at once on the machine: each is a page with its own memory. */
export const MAX_SESSIONS = 6;
export const SESSION_IDLE_MS = Number(process.env.FACETSHOT_SESSION_IDLE_MINUTES ?? 10) * 60_000;

export interface OpenRequest {
	target: string;
	/** One device (default: the first of the default profile's). */
	on?: string;
	/** One variant (default: the first of the default profile's). */
	as?: string;
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
	/** The screenshot, in CSS pixels (so `@x,y` in a step is a point on it); none when `picture: false`. */
	image?: string;
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
	page!: PageSession;
	private open!: (address: string) => Promise<void>;
	start = '/';

	constructor(
		readonly id: string,
		readonly root: string,
		private ctx: RunContext,
		readonly folder: string
	) {
		this.tail = new LogTail(join(ctx.stateDir, 'logs'));
	}

	get log(): LogBook {
		return this.page.watch.log;
	}

	/** One thing at a time per session: two agents' steps on one page would be anyone's guess. */
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
		const cell = planned.cells.find(
			(each) => each.device.platform === 'web' && each.target.kind === 'web'
		);
		if (!cell) {
			throw new UsageError(
				planned.unmatched[0] ??
					`Sessions open web pages for now; "${request.target}" on ${request.on ?? 'the default device'} isn't one.`,
				'Give a path (/settings) or a full URL, and a web device (--on phone). App, Storybook and desktop sessions are planned.'
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
			const driver = new WebDriver();
			await driver.prepare([cell], ctx);
			const browser = await runtime.browser(engineOf(config, cell.device), cell.variant.appearance);
			const made = await newSession(browser, cell.device, cell.variant, config.web, {
				baseURL: driver.url,
				root: ctx.root,
				stateDir: ctx.stateDir
			});
			closers.push(made.close);
			session.page = made.session;
			session.open = async (address: string) => {
				session.page.watch.reset();
				await navigate(session.page.page, fillAddress(cell, address, ctx.values));
			};
			session.start = cell.target.value;
			// The servers' log starts here: building and starting them is setup, not something the page did.
			session.tail = new LogTail(join(ctx.stateDir, 'logs'));
			await ctx.pools.web.run(() => session.open(session.start));
			const view = await ctx.pools.web.run(() => session.view({ elements: true }));
			return { session, view };
		} catch (error) {
			await session.close();
			throw error;
		}
	}

	/** Does the steps in order, stopping at the first that fails, then shows where the page is. */
	act(steps: Step[], options: LookOptions = {}): Promise<View> {
		return this.serial(() =>
			this.ctx.pools.web.run(async () => {
				let failed: View['failed'];
				for (const [index, step] of steps.entries()) {
					if ('shot' in step) continue;
					try {
						// Worked out before the step: a click may take the element away.
						const kept = await lasting(this.page.page, step);
						await doStep(this.page.page, step, this.open);
						this.steps.push(kept);
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
		return this.serial(() => this.ctx.pools.web.run(() => this.view(options)));
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
		const { page, watch, device, variant } = this.page;
		const address = new URL(page.url()).pathname;
		const settled = await waitReady(page, watch, {
			...readyRuleFor(address, this.ctx.config.web?.ready),
			timeout: 8000
		});
		const findings = await readPage(page, watch, ['console', 'network'], device);
		watch.failures.length = 0;
		watch.consoleErrors.length = 0;
		let picture: Pick<View, 'image' | 'width' | 'height'> = {};
		if (options.picture !== false) {
			this.views += 1;
			const image = join(this.folder, `${String(this.views).padStart(3, '0')}.png`);
			const buffer = await page.screenshot({
				path: image,
				fullPage: options.full ?? false,
				animations: 'disabled',
				caret: 'hide',
				scale: 'css',
				timeout: 20_000
			});
			picture = { image, width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
		}
		const snapshot =
			options.elements || options.tree
				? await page.ariaSnapshot({ mode: 'ai', boxes: true, timeout: 10_000 }).catch(() => '')
				: '';
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
			url: redact(page.url()),
			title: await page.title().catch(() => ''),
			device: device.name,
			variant: variant.name,
			...picture,
			logs,
			findings,
			elements: options.elements
				? onScreen(snapshot, page.viewportSize() ?? { width: 1e5, height: 1e5 })
				: undefined,
			tree: options.tree ? snapshot.replace(/ \[box=[^\]]*\]/g, '') : undefined,
			unsettled: settled.ready ? undefined : settled.waitingFor
		};
	}

	info(): SessionInfo {
		return {
			id: this.id,
			root: this.root,
			url: this.page?.page.url() ?? '',
			device: this.page?.device.name ?? '',
			variant: this.page?.variant.name ?? '',
			steps: this.steps.length,
			idleSeconds: Math.round((Date.now() - this.lastUsed) / 1000)
		};
	}

	/** The steps that worked, as a flow file that `facetshot <file>` plays again. */
	saveFlow(file: string): string {
		const path = resolve(this.root, file);
		// A flow belongs to the project: a name that climbs out of it (../, an absolute path elsewhere) is refused.
		const inside = relative(this.root, path);
		if (!inside || inside.startsWith('..') || isAbsolute(inside)) {
			throw new UsageError(
				`A flow is saved inside the project (${this.root}); "${file}" is outside it.`,
				'Give a path in the project, e.g. flows/edit-settings.yaml.'
			);
		}
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, stringify({ start: this.start, steps: [...this.steps, { shot: 'end' }] }));
		return path;
	}

	/** Closes the page and lets go of what the session started (test data goes with the project's runtime). */
	async close(): Promise<void> {
		for (const close of this.closers.reverse()) await within(close(), 10_000);
		this.closers = [];
		rmSync(this.folder, { recursive: true, force: true });
	}
}

/** Roles a person acts on. Anything the page marks as clickable (`cursor=pointer`) counts too. */
const ACTIONABLE = new Set([
	'button',
	'link',
	'textbox',
	'searchbox',
	'checkbox',
	'radio',
	'switch',
	'combobox',
	'listbox',
	'option',
	'menuitem',
	'menuitemcheckbox',
	'menuitemradio',
	'tab',
	'slider',
	'spinbutton',
	'treeitem',
	'gridcell',
	'columnheader',
	'separator'
]);

/**
 * What on screen can be acted on, read from Playwright's accessibility snapshot in its "ai" mode: each line has the
 * element's ref and box. A frame's boxes are relative to the frame, so they are moved by the frame's own box.
 */
export function onScreen(
	snapshot: string,
	viewport: { width: number; height: number }
): OnScreen[] {
	const out: OnScreen[] = [];
	/** The offset of the frame each indentation level is in. */
	const frames: { indent: number; x: number; y: number }[] = [];
	for (const line of snapshot.split('\n')) {
		const match = /^(\s*)- ([\w-]+)(?: "((?:[^"\\]|\\.)*)")?(.*)$/.exec(line);
		if (!match) continue;
		const [, space, role, rawName, rest] = match;
		const indent = space.length;
		while (frames.length && frames[frames.length - 1].indent >= indent) frames.pop();
		const offset = frames[frames.length - 1] ?? { x: 0, y: 0 };
		const ref = /\[ref=([\w]+)\]/.exec(rest)?.[1];
		const box = /\[box=(-?[\d.]+),(-?[\d.]+),([\d.]+),([\d.]+)\]/.exec(rest);
		if (!box) continue;
		const [x, y, width, height] = box.slice(1).map(Number);
		if (role === 'iframe') frames.push({ indent, x: offset.x + x, y: offset.y + y });
		if (!ref || !(ACTIONABLE.has(role) || rest.includes('[cursor=pointer]'))) continue;
		const left = offset.x + x;
		const top = offset.y + y;
		if (width < 1 || height < 1) continue;
		if (left + width < 0 || top + height < 0 || left > viewport.width || top > viewport.height)
			continue;
		const states = [
			...rest.matchAll(/\[(checked|disabled|expanded|selected|pressed|checked=mixed|active)\]/g)
		].map((state) => state[1]);
		const value = /\]:\s*(.+)$/.exec(rest)?.[1]?.trim();
		out.push({
			ref,
			role,
			name: (rawName ?? '').replace(/\\"/g, '"'),
			x: Math.round(left),
			y: Math.round(top),
			width: Math.round(width),
			height: Math.round(height),
			states: states.length ? states : undefined,
			value: value && !value.endsWith(':') ? value.slice(0, 80) : undefined
		});
		if (out.length >= 200) break;
	}
	return out;
}

/** A step's ref (`e12`, `ref=e12`), if it names one. */
export function refOf(target: string): string | undefined {
	return /^(?:ref=)?((?:f\d+)?e\d+)$/.exec(target.trim())?.[1];
}

/**
 * The step with each ref replaced by a selector that finds the element again in a later run: Playwright's own
 * best locator for it (role and name, test id, label…), written as a selector; a CSS path when there's none.
 */
async function lasting(page: PageSession['page'], step: Step): Promise<Step> {
	const out: Record<string, unknown> = { ...step };
	for (const [key, value] of Object.entries(out)) {
		const ref = typeof value === 'string' ? refOf(value) : undefined;
		if (!ref) continue;
		const element = page.getByRef(ref);
		const code = await element
			.normalize()
			.then((locator) => locator.toString())
			.catch(() => '');
		out[key] = selectorOf(code) ?? (await cssPath(element)) ?? value;
	}
	return out as Step;
}

/** A Playwright locator written as code (`getByRole('button', { name: 'Save' })`), as a selector string. */
export function selectorOf(code: string): string | undefined {
	const quoted = `'((?:[^'\\\\]|\\\\.)*)'`;
	const unquote = (text: string) => text.replace(/\\'/g, "'");
	let match = new RegExp(
		`^getByRole\\(${quoted}(?:, \\{ name: ${quoted}(, exact: true)? \\})?\\)$`
	).exec(code);
	if (match)
		return match[2] === undefined
			? `role=${match[1]}`
			: `role=${match[1]}[name=${JSON.stringify(unquote(match[2]))}${match[3] ? 's' : 'i'}]`;
	match = new RegExp(`^getByTestId\\(${quoted}\\)$`).exec(code);
	if (match) return `internal:testid=[data-testid=${JSON.stringify(unquote(match[1]))}s]`;
	match = new RegExp(
		`^getBy(Text|Label|Placeholder|AltText|Title)\\(${quoted}(, \\{ exact: true \\})?\\)$`
	).exec(code);
	if (match) {
		const engine = {
			Text: 'text',
			Label: 'label',
			Placeholder: 'placeholder',
			AltText: 'alt',
			Title: 'title'
		}[match[1] as 'Text'];
		return `internal:${engine}=${JSON.stringify(unquote(match[2]))}${match[3] ? 's' : 'i'}`;
	}
	match = new RegExp(`^locator\\(${quoted}\\)$`).exec(code);
	if (match) return unquote(match[1]);
	return undefined;
}

async function cssPath(
	element: ReturnType<PageSession['page']['getByRef']>
): Promise<string | undefined> {
	return element
		.evaluate(
			(node) => {
				const parts: string[] = [];
				for (
					let at: globalThis.Element | null = node as globalThis.Element;
					at && at !== document.body;
					at = at.parentElement
				) {
					if (at.id) {
						parts.unshift(`#${CSS.escape(at.id)}`);
						break;
					}
					const tag = at.tagName.toLowerCase();
					const same = at.parentElement
						? [...at.parentElement.children].filter((child) => child.tagName === at!.tagName)
						: [];
					parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(at) + 1})` : tag);
				}
				return `css=${parts.join(' > ')}`;
			},
			undefined,
			{ timeout: 2000 }
		)
		.catch(() => undefined);
}

/** A view as text: where, what happened, what's clickable. Shared by the CLI and the MCP server. */
export function describeView(view: View): string {
	const lines = [
		`${view.session} · ${view.device}/${view.variant} · ${view.url}${view.title ? ` · "${view.title}"` : ''}`
	];
	if (view.failed) lines.push(`✗ Step ${view.failed.step} didn't work: ${view.failed.error}`);
	if (view.unsettled) lines.push(`! Not settled after 8s: still waiting for ${view.unsettled}.`);
	if (view.image)
		lines.push(`Screenshot: ${view.image} (${view.width}×${view.height}, CSS pixels)`);
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
