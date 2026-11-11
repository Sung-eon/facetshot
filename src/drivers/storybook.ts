/**
 * Storybook stories, each opened on its own (`iframe.html?id=…&viewMode=story`) in the same browser, devices and
 * variants as web pages, with the same readiness rules and checks.
 *
 * The story list comes from Storybook's `index.json` (format v4/v5, Storybook 7 to 10). A target is an id
 * (`story:button--primary`), a title or `title/name` (`story:Button`, `story:Button/Primary`), or a glob over ids
 * and `title/name` (`story:Button/*`, `story:Forms/**`, `story:*`). One planned cell becomes one picture per
 * story; each story is its own screen.
 *
 * What a story says about itself:
 * - Tags (in index.json): `facetshot-skip` leaves a story out of patterns, and so does opting it out of tests
 *   (`!test`: Storybook 8.1+ then lists the story without its default `test` tag). A story named by its exact id
 *   is shot anyway — asking for it by name says you want it.
 * - `parameters.facetshot` (`{ skip, ready, mask }`): Storybook 8+ no longer writes parameters into index.json, so
 *   they are only known once the story has loaded in the preview. facetshot reads them there, before it waits and
 *   shoots: `skip: true` reports the story as skipped, `ready` is laid over the readiness rule, `mask` adds
 *   selectors to paint over.
 */
import { join } from 'node:path';
import type { Page } from 'playwright';
import type { Cell, CellResult, ReadyRule, StorybookConfig, Variant } from '../types.ts';
import { ensureBuilt } from '../engine/build.ts';
import { healthy } from '../engine/procs.ts';
import { serveStatic } from '../engine/static.ts';
import { EnvironmentError, firstLine, UsageError } from '../errors.ts';
import { fill, slugify } from '../plan.ts';
import { failed, result, type Driver, type RunContext } from './driver.ts';
import { globToRegExp, layRule, readyRuleFor } from './page.ts';
import {
	newSession,
	engineOf,
	navigate,
	pictureOf,
	shootInContexts,
	type PageSession
} from './web.ts';

/** One entry of Storybook's index.json, as much of it as facetshot reads. */
export interface StoryEntry {
	id: string;
	title: string;
	name: string;
	type: 'story' | 'docs';
	tags: string[];
}

/** Reads index.json (v4/v5: `entries`) or the older stories.json (v3: `stories`). */
export function parseIndex(data: unknown): StoryEntry[] {
	const record = data as {
		v?: number;
		entries?: Record<string, Partial<StoryEntry>>;
		stories?: Record<string, Partial<StoryEntry>>;
	};
	const entries = record?.entries ?? record?.stories;
	if (!entries || typeof entries !== 'object') {
		throw new EnvironmentError(
			"Storybook's index has no `entries`.",
			'facetshot reads index.json from Storybook 7 or later; upgrade Storybook, or check storybook.url points at Storybook itself.'
		);
	}
	return Object.values(entries)
		.filter((entry): entry is Partial<StoryEntry> & { id: string } => typeof entry?.id === 'string')
		.map((entry) => ({
			id: entry.id,
			title: entry.title ?? '',
			name: entry.name ?? entry.id,
			// v3 entries have no type; everything in stories.json was a story unless it was docs-only.
			type: entry.type === 'docs' ? 'docs' : 'story',
			tags: Array.isArray(entry.tags) ? entry.tags : []
		}));
}

/** Whether a story stays out of patterns: tagged `facetshot-skip`, or opted out of tests. */
export function skippedByTags(tags: string[]): boolean {
	if (tags.includes('facetshot-skip') || tags.includes('!test')) return true;
	// Storybook 8.1+ resolves tags: every story gets `dev` and `test` unless it opts out (`!test`), so a story
	// with `dev` but no `test` was taken out of testing on purpose.
	return tags.includes('dev') && !tags.includes('test');
}

/**
 * The stories a pattern names, in index order. Matching ignores case. An exact id or `title/name` is taken even
 * when its tags would skip it; anything wider leaves skipped stories and docs pages out.
 */
export function matchStories(pattern: string, entries: StoryEntry[]): StoryEntry[] {
	const stories = entries.filter((entry) => entry.type === 'story');
	const wanted = pattern.trim().toLowerCase();
	const path = (entry: StoryEntry) => `${entry.title}/${entry.name}`.toLowerCase();
	const exact = stories.filter(
		(entry) => entry.id.toLowerCase() === wanted || path(entry) === wanted
	);
	if (exact.length) return exact;
	const kept = stories.filter((entry) => !skippedByTags(entry.tags));
	if (wanted === '*' || wanted === '**' || wanted === '') return kept;
	if (!/[*?]/.test(wanted)) {
		// A title (or the start of one): every story of that component, or of a folder of components.
		return kept.filter((entry) => {
			const title = entry.title.toLowerCase();
			return title === wanted || title.startsWith(`${wanted}/`);
		});
	}
	const glob = globToRegExp(wanted);
	return kept.filter(
		(entry) =>
			glob.test(entry.id.toLowerCase()) ||
			glob.test(path(entry)) ||
			glob.test(entry.title.toLowerCase())
	);
}

/** The screen (one contact sheet) a story gets: `Pricing/PlanCard` + `Highlighted` → `Pricing.PlanCard.Highlighted`. */
export function storyScreen(entry: Pick<StoryEntry, 'title' | 'name'>): string {
	return slugify(`${entry.title}/${entry.name}`.replace(/\//g, '.'));
}

/**
 * The `globals` query value for a variant: every `storybook.globals` entry whose key is the variant's name, one of
 * its `+` parts, or one of its values (`dark`, `rtl`, `large`). `{locale}` is the variant's locale.
 */
export function globalsFor(variant: Variant, globals: StorybookConfig['globals']): string {
	if (!globals) return '';
	const keys = new Set<string>([
		variant.name,
		...variant.name.split('+'),
		...(
			[variant.appearance, variant.text, variant.direction, variant.contrast, variant.motion] as (
				string | undefined
			)[]
		).filter((value): value is string => !!value)
	]);
	if (variant.locale) keys.add('locale');
	const parts: string[] = [];
	for (const [key, value] of Object.entries(globals)) {
		if (keys.has(key)) parts.push(fill(value, { locale: variant.locale ?? '' }));
	}
	return [...new Set(parts.flatMap((part) => part.split(';')).filter(Boolean))].join(';');
}

/** The address of one story in the preview iframe. */
export function storyUrl(base: string, id: string, globals = ''): string {
	const url = new URL('iframe.html', base.endsWith('/') ? base : `${base}/`);
	url.searchParams.set('id', id);
	url.searchParams.set('viewMode', 'story');
	let href = url.href;
	// Storybook reads `globals` as `key:value;key:value` and does not decode `:` or `;`, so it goes in as written.
	if (globals)
		href += `&globals=${globals
			.split(';')
			.map((pair) => pair.split(':').map(encodeURIComponent).join(':'))
			.join(';')}`;
	return href;
}

/**
 * Runs in the preview iframe: undefined once the story has rendered, otherwise what it is still waiting for.
 * Storybook 7–10 mark the body (`sb-show-main` when the story is on screen, `sb-show-errordisplay` when it threw,
 * `sb-show-preparing-story` while loading), and keep the current render on `__STORYBOOK_PREVIEW__` with a phase
 * that is `rendering`/`playing` until the render and play function are done.
 */
function storybookState(): {
	done: boolean;
	waitingFor?: string;
	error?: string;
	parameters?: unknown;
} {
	const body = document.body;
	if (!body) return { done: false, waitingFor: 'the preview to load' };
	if (body.classList.contains('sb-show-errordisplay')) {
		const message =
			document.getElementById('error-message')?.textContent?.trim() ??
			'The story threw while rendering.';
		return { done: true, error: message.slice(0, 300) };
	}
	if (body.classList.contains('sb-show-nopreview'))
		return { done: true, error: 'Storybook shows "No Preview" for this story.' };
	if (
		body.classList.contains('sb-show-preparing-story') ||
		!body.classList.contains('sb-show-main')
	) {
		return { done: false, waitingFor: 'Storybook to show the story' };
	}
	const preview = (
		window as unknown as {
			__STORYBOOK_PREVIEW__?: {
				currentRender?: { phase?: string; story?: { parameters?: unknown } };
			};
		}
	).__STORYBOOK_PREVIEW__;
	const render = preview?.currentRender;
	const busy = ['preparing', 'loading', 'beforeEach', 'rendering', 'playing'];
	if (render?.phase && busy.includes(render.phase))
		return { done: false, waitingFor: `the story (${render.phase})` };
	if (render?.phase === 'errored')
		return { done: true, error: 'The story failed to render (see the console findings).' };
	const root = document.getElementById('storybook-root') ?? document.getElementById('root');
	if (root && !root.children.length && !root.textContent?.trim())
		return { done: false, waitingFor: 'the story to put something on screen' };
	let parameters: unknown;
	try {
		// Only what can be sent back: parameters are plain data except the odd function, which JSON drops.
		parameters = JSON.parse(
			JSON.stringify(
				(render?.story?.parameters as Record<string, unknown> | undefined)?.facetshot ?? null
			)
		);
	} catch {
		parameters = null;
	}
	return { done: true, parameters };
}

interface StoryParameters {
	skip?: boolean;
	ready?: ReadyRule;
	mask?: string[];
}

export class StorybookDriver implements Driver {
	readonly name = 'storybook';
	private url = '';
	private entries: StoryEntry[] = [];

	handles(cell: Cell): boolean {
		return cell.target.kind === 'story' && cell.device.platform === 'web';
	}

	async prepare(cells: Cell[], ctx: RunContext): Promise<void> {
		const storybook = ctx.config.storybook;
		if (!storybook?.url && !storybook?.build) {
			throw new UsageError(
				'story: targets need to know where Storybook is.',
				'Set storybook.url (a running Storybook, e.g. http://localhost:6006) or storybook.build (a static build facetshot makes and serves) in facetshot.config.ts.'
			);
		}
		// The browser starts while Storybook builds: neither needs the other.
		// One engine that won't start fails only its own pictures (in shoot); with none, there's nothing to do.
		const browser = Promise.allSettled(
			[...new Set(cells.map((cell) => engineOf(ctx.config, cell.device)))].map((engine) =>
				ctx.runtime.browser(engine)
			)
		).then((outcomes) => {
			if (outcomes.every((outcome) => outcome.status === 'rejected'))
				throw (outcomes[0] as PromiseRejectedResult).reason;
		});
		browser.catch(() => {});
		const url = storybook.url ? fill(storybook.url, ctx.values).replace(/\/$/, '') : undefined;
		if (url && (await healthy(url))) {
			this.url = url;
		} else if (storybook.build) {
			const built = await ensureBuilt('storybook', storybook.build, {
				...ctx,
				heavyLock: ctx.locks.build
			});
			const folder = built.output ?? join(ctx.root, storybook.build.output);
			// A server kept by the daemon serves the folder as it is on disk, so a rebuild needs no restart; only a
			// server that has stopped answering is replaced.
			const running = await ctx.runtime.service(
				`${ctx.root}\u0000storybook`,
				() => serveStatic('storybook', folder),
				{ health: (each) => healthy(`${each.url}/index.json`) }
			);
			this.url = running.url;
		} else {
			throw new EnvironmentError(
				`Storybook isn't answering at ${url}.`,
				'Start it (npm run storybook), or add storybook.build so facetshot can build and serve it itself.'
			);
		}
		ctx.values['storybook.url'] = this.url;
		this.entries = await this.readIndex();
		await browser;
	}

	private async readIndex(): Promise<StoryEntry[]> {
		for (const file of ['index.json', 'stories.json']) {
			const response = await fetch(`${this.url}/${file}`, {
				signal: AbortSignal.timeout(30_000)
			}).catch(() => undefined);
			if (response?.ok) return parseIndex(await response.json());
		}
		throw new EnvironmentError(
			`${this.url} has no index.json.`,
			'Check that storybook.url (or the build output) is a Storybook 7+ and that it finished building.'
		);
	}

	/**
	 * One cell per story the cell's target names (sceneId = story id, screen = the story's title and name). A cell
	 * that names no story is kept as it is, and reported as failed when it is shot.
	 */
	expand(cells: Cell[]): Cell[] {
		return cells.flatMap((cell) => {
			if (cell.sceneId) return [cell];
			const stories = matchStories(cell.target.value, this.entries);
			if (!stories.length) return [cell];
			return stories.map((story) => ({ ...cell, sceneId: story.id, screen: storyScreen(story) }));
		});
	}

	async shoot(cells: Cell[], ctx: RunContext, report: (result: CellResult) => void): Promise<void> {
		const web = ctx.config.web;
		const storybook = ctx.config.storybook ?? {};
		const found = cells.filter((cell) => {
			if (cell.sceneId) return true;
			report(
				failed(
					cell,
					`No story matches "${cell.target.value}". Ids look like "button--primary"; titles like "Button" or "Button/Primary"; globs like "Button/*". The stories are listed at ${this.url}/index.json.`
				)
			);
			return false;
		});
		await shootInContexts(
			found,
			ctx,
			async (device, variant) =>
				newSession(
					await ctx.runtime.browser(engineOf(ctx.config, device), variant.appearance),
					device,
					variant,
					web,
					{
						baseURL: this.url,
						root: ctx.root
					}
				),
			(session, cell) => this.shootStory(session, cell, ctx, storybook, report),
			report
		);
	}

	private async shootStory(
		session: PageSession,
		cell: Cell,
		ctx: RunContext,
		storybook: StorybookConfig,
		report: (result: CellResult) => void
	): Promise<void> {
		const started = Date.now();
		const id = cell.sceneId!;
		const web = ctx.config.web;
		try {
			session.watch.reset();
			await navigate(
				session.page,
				storyUrl(this.url, id, globalsFor(cell.variant, storybook.globals))
			);
			const base = storybook.ready ?? web?.ready;
			const timeout = base?.timeout ?? 15_000;
			const state = await waitForStorybook(session.page, timeout);
			const parameters = (state.parameters ?? {}) as StoryParameters;
			if (parameters.skip) {
				report(
					result(cell, {
						status: 'skipped',
						ms: Date.now() - started,
						notes: ['parameters.facetshot.skip is set on this story.']
					})
				);
				return;
			}
			// Route rules in web.ready / storybook.ready are matched against the story id.
			const out = await pictureOf(session, cell, cell.screen, ctx, {
				rule: layRule(readyRuleFor(id, base), parameters.ready),
				started,
				fullPage: web?.fullPage,
				mask: [...(web?.mask ?? []), ...(parameters.mask ?? [])]
			});
			if (state.error)
				(out.findings ??= []).unshift({
					check: 'console',
					severity: 'error',
					message: `Storybook: ${state.error}`
				});
			if (state.waitingFor) {
				out.readyTimedOut = true;
				(out.notes ??= []).unshift(
					`Storybook didn't say the story had rendered after ${timeout / 1000}s: still waiting for ${state.waitingFor}.`
				);
			}
			report(out);
		} catch (error) {
			report(failed(cell, firstLine(error), Date.now() - started));
		}
	}
}

/** Polls the preview until Storybook says the story is on screen (or failed), or the time is up. */
async function waitForStorybook(
	page: Page,
	timeout: number
): Promise<{ waitingFor?: string; error?: string; parameters?: unknown }> {
	const deadline = Date.now() + timeout;
	let waitingFor = 'the preview to load';
	while (Date.now() < deadline) {
		const state = await page.evaluate(storybookState).catch((error: Error) => ({
			done: false,
			waitingFor: `the preview (${error.message.split('\n')[0]})`,
			error: undefined,
			parameters: undefined
		}));
		if (state.done) return { error: state.error, parameters: state.parameters };
		waitingFor = state.waitingFor ?? waitingFor;
		await page.waitForTimeout(50);
	}
	return { waitingFor };
}
