/**
 * Web pages in a real browser. One browser, one context per device × variant (so emulation is set once, not per
 * picture), each reusing its page from screen to screen, with a cap on how many work at the same time.
 */
import type { Browser, Page } from 'playwright';
import type {
	BuildStep,
	Cell,
	CellResult,
	Config,
	Device,
	Persona,
	ReadyRule,
	Service,
	Variant,
	WebConfig
} from '../types.ts';
import { ensureBuilt } from '../engine/build.ts';
import { ensureService, within, type Running } from '../engine/procs.ts';
import type { Engine } from '../engine/runtime.ts';
import { EnvironmentError, firstLine, UsageError } from '../errors.ts';
import { loadFlow, playInPage, shotNames } from '../flows.ts';
import { fill } from '../plan.ts';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import {
	byDeviceAndVariant,
	failed,
	failRest,
	fillAddress,
	groupBy,
	result,
	stopped,
	type Driver,
	type RunContext
} from './driver.ts';
import {
	contextOptions,
	imagePath,
	NetworkWatch,
	readPage,
	readyRuleFor,
	routeRequests,
	takePicture,
	variantScript,
	waitReady
} from './page.ts';

/** A page ready for pictures, with what watches it. Shared with Storybook, Electron and Tauri's frontend. */
export interface PageSession {
	page: Page;
	watch: NetworkWatch;
	device: Device;
	variant: Variant;
}

/**
 * A browser context of its own for one device × variant, with the persona signed in, the variant made true and the
 * config's request rules, and its page; `close` closes the context.
 */
export async function newSession(
	browser: Browser,
	device: Device,
	variant: Variant,
	web: WebConfig | undefined,
	options: { baseURL?: string; root: string; initScript?: string }
): Promise<{ session: PageSession; close: () => Promise<void> }> {
	const personaName = variant.persona ?? web?.persona;
	const persona: Persona | undefined = personaName ? web?.personas?.[personaName] : undefined;
	if (personaName && !persona) {
		throw new UsageError(
			`There's no persona called "${personaName}".`,
			`Define it under web.personas in your config. Known: ${Object.keys(web?.personas ?? {}).join(', ') || 'none'}.`
		);
	}
	const storageState = persona?.storageState
		? resolve(options.root, persona.storageState)
		: undefined;
	if (storageState && !existsSync(storageState)) {
		throw new UsageError(
			`The persona "${personaName}" points at ${storageState}, which doesn't exist.`
		);
	}
	const context = await browser.newContext({
		...contextOptions(device, variant),
		baseURL: options.baseURL,
		storageState,
		extraHTTPHeaders: persona?.headers
	});
	if (persona?.cookies?.length && options.baseURL) {
		const url = new URL(options.baseURL);
		await context.addCookies(
			persona.cookies.map((cookie) => ({
				path: '/',
				...cookie,
				domain: cookie.domain ?? url.hostname
			}))
		);
	}
	await context.addInitScript(
		variantScript(variant, {
			...web,
			storage: { ...(web?.storage ?? {}), ...(persona?.storage ?? {}) }
		})
	);
	if (options.initScript) await context.addInitScript(options.initScript);
	const blocked = await routeRequests(context, web);
	const page = await context.newPage();
	if (variant.media === 'print') await page.emulateMedia({ media: 'print' });
	if (web?.clock) await page.clock.setFixedTime(new Date(web.clock));
	return {
		session: { page, watch: new NetworkWatch(page, blocked), device, variant },
		close: () => context.close()
	};
}

/** How the web driver and the ones built on it (Electron, Tauri's frontend) show one address in a page. */
export interface ShootOptions {
	ctx: RunContext;
	web: WebConfig | undefined;
	/** How to show one address in this page (navigate, or ask an app to route). */
	open: (session: PageSession, address: string) => Promise<void>;
}

/**
 * Waits for the page to settle, reads it with the run's checks and takes its picture: one result, with a note when
 * the page didn't settle in time. Shared by every driver that has a page.
 */
export async function pictureOf(
	session: PageSession,
	cell: Cell,
	screen: string,
	ctx: RunContext,
	options: { rule: ReadyRule; started: number; mask?: string[]; fullPage?: boolean }
): Promise<CellResult> {
	const { rule, started } = options;
	const settled = await waitReady(session.page, session.watch, rule);
	const out = result(cell, {
		screen,
		ms: Date.now() - started,
		findings: await readPage(session.page, session.watch, ctx.checks, session.device),
		readyTimedOut: settled.ready ? undefined : true,
		notes: settled.ready
			? undefined
			: [
					`Not settled after ${(rule.timeout ?? 15_000) / 1000}s: still waiting for ${settled.waitingFor}.`
				]
	});
	if (ctx.images) {
		const { file, rel } = imagePath(ctx.runDir, screen, cell.device.name, cell.variant.name);
		const size = await takePicture(session.page, file, {
			fullPage: options.fullPage,
			mask: options.mask
		});
		Object.assign(out, { image: rel, ...size, ms: Date.now() - started });
	}
	return out;
}

/** One cell: open it (or play its flow), wait, read, shoot. Reports one result per picture. */
export async function shootCell(
	session: PageSession,
	cell: Cell,
	options: ShootOptions,
	report: (result: CellResult) => void
): Promise<void> {
	const { ctx, web } = options;
	const started = Date.now();
	const picture = async (screen: string, address: string) =>
		report(
			await pictureOf(session, cell, screen, ctx, {
				rule: readyRuleFor(address, web?.ready),
				started,
				mask: web?.mask,
				fullPage: web?.fullPage
			})
		);
	try {
		if (cell.target.kind === 'flow') {
			const flow = loadFlow(cell.target.value, ctx.root);
			let taken = 0;
			try {
				await playInPage(
					session.page,
					flow,
					async (address) => {
						session.watch.reset();
						await options.open(session, fill(address, ctx.values));
					},
					async (name) => {
						taken += 1;
						await picture(`${cell.screen}.${name}`, flow.start);
					}
				);
			} catch (error) {
				failRest(cell, shotNames(flow), taken, error, started, report);
			}
			return;
		}
		const address = fillAddress(cell, cell.sceneId ?? cell.target.value, ctx.values);
		session.watch.reset();
		await options.open(session, address);
		await picture(cell.screen, address);
	} catch (error) {
		report(failed(cell, firstLine(error), Date.now() - started));
	}
}

/**
 * Groups cells by device × variant, gives each group a page of its own (`makeSession`) and works through the groups
 * with the web pool's limit, each group's cells one after another in its page.
 */
export async function shootInContexts(
	cells: Cell[],
	ctx: RunContext,
	makeSession: (
		device: Device,
		variant: Variant
	) => Promise<{ session: PageSession; close: () => Promise<void> }>,
	shootOne: (session: PageSession, cell: Cell) => Promise<void>,
	report: (result: CellResult) => void
): Promise<void> {
	await ctx.pools.web.each(
		groupBy(cells, byDeviceAndVariant),
		async (group) => {
			let made: Awaited<ReturnType<typeof makeSession>>;
			try {
				made = await makeSession(group[0].device, group[0].variant);
			} catch (error) {
				for (const cell of group) report(failed(cell, firstLine(error)));
				return;
			}
			try {
				for (const cell of group) {
					if (ctx.signal.aborted) report(stopped(cell));
					else await shootOne(made.session, cell);
				}
			} finally {
				await within(made.close(), 10_000);
			}
		},
		ctx.signal
	);
}

/** Builds (if its inputs changed) and keeps one server, started again when it stops answering or the build changes. */
export async function builtServer(
	ctx: RunContext,
	name: string,
	build: BuildStep | undefined,
	serve: Service
): Promise<Running> {
	const version = build
		? (await ensureBuilt(name, build, { ...ctx, heavyLock: ctx.locks.build })).hash
		: undefined;
	return ctx.runtime.service(`${ctx.root}\u0000${name}`, () => ensureService(name, serve, ctx), {
		version
	});
}

export function engineOf(config: Config): Engine {
	return config.web?.browser ?? 'chromium';
}

/** Navigates and waits for the document; readiness is waited for separately. */
export async function navigate(page: Page, url: string): Promise<void> {
	const response = await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
	if (response && response.status() >= 400) {
		throw new Error(`${url} answered ${response.status()}.`);
	}
}

export class WebDriver implements Driver {
	readonly name = 'web';
	private baseURL: string | undefined;

	handles(cell: Cell): boolean {
		return (
			cell.device.platform === 'web' && (cell.target.kind === 'web' || cell.target.kind === 'flow')
		);
	}

	async prepare(cells: Cell[], ctx: RunContext): Promise<void> {
		const web = ctx.config.web;
		const relative = cells.some(
			(cell) =>
				(cell.target.kind === 'web' && cell.target.value.startsWith('/')) ||
				cell.target.kind === 'flow'
		);
		// The browser starts while the app builds and its server comes up: neither needs the other.
		const browser = ctx.runtime.browser(engineOf(ctx.config));
		browser.catch(() => {});
		if (web?.baseURL) {
			this.baseURL = fill(web.baseURL, ctx.values);
		} else if (relative) {
			if (!web?.serve) {
				throw new UsageError(
					'Paths like "/talk" need to know where your app is.',
					'Set web.baseURL (an address you run yourself) or web.serve (a command facetshot starts) in facetshot.config.ts — or give full URLs.'
				);
			}
			// A server kept from an earlier run is used again unless it has died, or the build under it changed.
			this.baseURL = (await builtServer(ctx, 'web', web.build, web.serve)).url;
		}
		if (this.baseURL) ctx.values['web.url'] = this.baseURL;
		await browser.catch((error) => {
			throw error instanceof EnvironmentError ? error : new EnvironmentError(String(error));
		});
	}

	async shoot(cells: Cell[], ctx: RunContext, report: (result: CellResult) => void): Promise<void> {
		const browser = await ctx.runtime.browser(engineOf(ctx.config));
		const web = ctx.config.web;
		const options: ShootOptions = {
			ctx,
			web,
			open: (session, address) => navigate(session.page, address)
		};
		await shootInContexts(
			cells,
			ctx,
			(device, variant) =>
				newSession(browser, device, variant, web, { baseURL: this.baseURL, root: ctx.root }),
			(session, cell) => shootCell(session, cell, options, report),
			report
		);
	}
}
