/**
 * Sessions: a screen kept open so an agent (or a person) can work it step by step — click, scroll, open a context
 * menu, type — and see the picture, the page's logs and what's clickable after each step. The daemon holds them; each
 * is one page on one device in one variant, with the project's servers, sign-in and test data, like a run's.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
	/** List what can be clicked or typed into, numbered for `#n` in steps. */
	elements?: boolean;
	/** The whole page rather than what's on screen. */
	full?: boolean;
	/** The least important log lines to return (default `info`). */
	logLevel?: LogLevel;
}

export interface Element {
	ref: number;
	role: string;
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
	disabled?: boolean;
	checked?: boolean;
	value?: string;
	/** A selector that finds it again outside this session, for saved flows. */
	selector?: string;
}

/** What a session shows after opening, a step, or a look. */
export interface View {
	session: string;
	url: string;
	title: string;
	device: string;
	variant: string;
	/** The picture, in CSS pixels (so `@x,y` in a step is a point on it). */
	image: string;
	width: number;
	height: number;
	/** Log lines since the last view. */
	logs: LogEntry[];
	/** Console errors and failed requests since the last view. */
	findings: Finding[];
	elements?: Element[];
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
	/** The last list's stable selectors, by `#n`. */
	private refs = new Map<number, string>();
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
			const browser = await runtime.browser(engineOf(config));
			const made = await newSession(browser, cell.device, cell.variant, config.web, {
				baseURL: driver.url,
				root: ctx.root
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
						await doStep(this.page.page, step, this.open);
						this.steps.push(this.lasting(step));
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

	/** The step with each `#n` replaced by a selector that still finds the element in a later run. */
	private lasting(step: Step): Step {
		const out: Record<string, unknown> = { ...step };
		for (const [key, value] of Object.entries(out)) {
			const ref = typeof value === 'string' ? /^#(\d+)$/.exec(value.trim()) : null;
			if (ref && this.refs.has(Number(ref[1]))) out[key] = this.refs.get(Number(ref[1]));
		}
		return out as Step;
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
		const width = buffer.readUInt32BE(16);
		const height = buffer.readUInt32BE(20);
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
			image,
			width,
			height,
			logs,
			findings,
			elements: options.elements ? this.remember(await listElements(page)) : undefined,
			unsettled: settled.ready ? undefined : settled.waitingFor
		};
	}

	private remember(elements: Element[]): Element[] {
		this.refs = new Map(elements.map((element) => [element.ref, element.selector ?? '']));
		return elements.map(({ selector: _, ...rest }) => rest);
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

/**
 * What on screen can be clicked or typed into, each marked with `data-facetshot-ref` so a step can name it `#n`.
 * Only what's in the viewport, at most 150, in reading order.
 */
async function listElements(page: PageSession['page']): Promise<Element[]> {
	return page
		.evaluate(() => {
			const selector = [
				'a[href]',
				'button',
				'input:not([type=hidden])',
				'select',
				'textarea',
				'summary',
				'[contenteditable=""]',
				'[contenteditable=true]',
				'[tabindex]:not([tabindex="-1"])',
				'[onclick]',
				...[
					'button',
					'link',
					'tab',
					'menuitem',
					'menuitemcheckbox',
					'menuitemradio',
					'checkbox',
					'radio',
					'switch',
					'option',
					'treeitem',
					'combobox',
					'textbox',
					'slider',
					'gridcell'
				].map((role) => `[role=${role}]`)
			].join(',');
			// A selector for saved flows: by role and name where Playwright can find it that way, else a CSS path.
			const named = [
				'button',
				'link',
				'checkbox',
				'radio',
				'switch',
				'tab',
				'menuitem',
				'option',
				'textbox',
				'combobox'
			];
			const lasting = (element: HTMLElement, role: string, name: string): string => {
				if (named.includes(role) && name && !element.getAttribute('role')?.includes(' '))
					return `role=${role}[name=${JSON.stringify(name)}]`;
				if (element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1)
					return `#${CSS.escape(element.id)}`;
				const parts: string[] = [];
				for (
					let at: HTMLElement | null = element;
					at && at !== document.body;
					at = at.parentElement
				) {
					const tag = at.tagName.toLowerCase();
					const same = at.parentElement
						? [...at.parentElement.children].filter((child) => child.tagName === at!.tagName)
						: [];
					parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(at) + 1})` : tag);
				}
				return `css=body > ${parts.join(' > ')}`;
			};
			for (const old of document.querySelectorAll('[data-facetshot-ref]'))
				old.removeAttribute('data-facetshot-ref');
			const roles: Record<string, string> = {
				A: 'link',
				BUTTON: 'button',
				SELECT: 'combobox',
				TEXTAREA: 'textbox',
				SUMMARY: 'button'
			};
			const out: Element[] = [];
			const seen = new Set<globalThis.Element>();
			for (const element of document.querySelectorAll<HTMLElement>(selector)) {
				if (out.length >= 150) break;
				if (seen.has(element)) continue;
				const box = element.getBoundingClientRect();
				const style = getComputedStyle(element);
				if (
					box.width < 1 ||
					box.height < 1 ||
					box.bottom < 0 ||
					box.right < 0 ||
					box.top > innerHeight ||
					box.left > innerWidth ||
					style.visibility === 'hidden' ||
					style.pointerEvents === 'none'
				)
					continue;
				// The element actually on top at its middle: something covered isn't clickable.
				const top = document.elementFromPoint(
					Math.min(Math.max(box.left + box.width / 2, 0), innerWidth - 1),
					Math.min(Math.max(box.top + box.height / 2, 0), innerHeight - 1)
				);
				if (top && top !== element && !element.contains(top) && !top.contains(element)) continue;
				seen.add(element);
				const input = element as HTMLInputElement;
				const labelled = element.getAttribute('aria-labelledby');
				const name = (
					element.getAttribute('aria-label') ||
					(labelled && document.getElementById(labelled)?.textContent) ||
					(input.labels?.[0]?.textContent ?? '') ||
					element.innerText ||
					input.placeholder ||
					element.title ||
					element.getAttribute('alt') ||
					''
				)
					.replace(/\s+/g, ' ')
					.trim()
					.slice(0, 80);
				const tag = element.tagName;
				const role =
					element.getAttribute('role') ||
					(tag === 'INPUT'
						? ['checkbox', 'radio'].includes(input.type)
							? input.type
							: input.type === 'range'
								? 'slider'
								: ['button', 'submit', 'reset'].includes(input.type)
									? 'button'
									: 'textbox'
						: (roles[tag] ?? (element.isContentEditable ? 'textbox' : 'generic')));
				const ref = out.length + 1;
				element.setAttribute('data-facetshot-ref', String(ref));
				out.push({
					ref,
					role,
					name,
					x: Math.round(box.left),
					y: Math.round(box.top),
					width: Math.round(box.width),
					height: Math.round(box.height),
					disabled: input.disabled || element.getAttribute('aria-disabled') === 'true' || undefined,
					checked:
						tag === 'INPUT' && ['checkbox', 'radio'].includes(input.type)
							? input.checked
							: element.getAttribute('aria-checked') === 'true' || undefined,
					value:
						(tag === 'INPUT' && !['checkbox', 'radio'].includes(input.type)) ||
						tag === 'TEXTAREA' ||
						tag === 'SELECT'
							? String(input.value).slice(0, 80) || undefined
							: undefined,
					selector: lasting(element, role, name)
				});
			}
			return out;
		})
		.catch(() => []);
}

/** A view as text: where, what happened, what's clickable. Shared by the CLI and the MCP server. */
export function describeView(view: View, options: { image?: boolean } = {}): string {
	const lines = [
		`${view.session} · ${view.device}/${view.variant} · ${view.url}${view.title ? ` · "${view.title}"` : ''}`
	];
	if (view.failed) lines.push(`✗ Step ${view.failed.step} didn't work: ${view.failed.error}`);
	if (view.unsettled) lines.push(`! Not settled after 8s: still waiting for ${view.unsettled}.`);
	if (options.image !== false)
		lines.push(`Picture: ${view.image} (${view.width}×${view.height}, CSS pixels)`);
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
		lines.push('', `On screen (${view.elements.length}; use #n in a step):`);
		for (const element of view.elements) {
			const state = [
				element.disabled && 'disabled',
				element.checked && 'checked',
				element.value !== undefined && `value "${element.value}"`
			]
				.filter(Boolean)
				.join(', ');
			lines.push(
				`  #${element.ref} ${element.role}${element.name ? ` "${element.name}"` : ''} @${element.x + Math.round(element.width / 2)},${element.y + Math.round(element.height / 2)}${state ? ` (${state})` : ''}`
			);
		}
	}
	return lines.join('\n') + '\n';
}
