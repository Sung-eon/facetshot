/**
 * Everything facetshot does to one browser page, shared by the web, Storybook and Electron drivers: making a variant
 * true (text size, direction, print), waiting until the screen has settled, reading it with checks, and taking the
 * screenshot.
 */
import { closeSync, mkdirSync, openSync, readFileSync, readSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { BrowserContext, Page, Request } from 'playwright';
import { inPage, PAGE_CHECKS } from '../checks/page.ts';
import { LogBook, recordPage, shortUrl } from '../logs.ts';
import type { Device, Finding, ReadyRule, Variant, WebConfig } from '../types.ts';

const TEXT_SIZES = { large: '125%', xlarge: '150%', xxl: '200%' } as const;

/** CSS and attributes a variant needs that the browser can't emulate on its own. Runs before any page script. */
export function variantScript(variant: Variant, web: WebConfig | undefined): string {
	const css: string[] = [];
	if (variant.text && variant.text !== 'default') {
		const size = web?.textSizes?.[variant.text] ?? TEXT_SIZES[variant.text];
		css.push(`html{font-size:${size} !important}`);
	}
	if (web?.css) css.push(web.css);
	const storage = { ...(web?.storage ?? {}) };
	return `(() => {
		try { const s = ${JSON.stringify(storage)}; for (const k in s) localStorage.setItem(k, s[k]); } catch {}
		const css = ${JSON.stringify(css.join('\n'))};
		const dir = ${JSON.stringify(variant.direction ?? '')};
		const apply = () => {
			if (dir) document.documentElement.setAttribute('dir', dir);
			if (css && !document.getElementById('__facetshot_css')) {
				const style = document.createElement('style');
				style.id = '__facetshot_css';
				style.textContent = css;
				(document.head || document.documentElement).appendChild(style);
			}
		};
		if (document.documentElement) apply();
		document.addEventListener('DOMContentLoaded', apply);
	})();`;
}

/** The media features a variant sets (for a context, or emulated on a page that already exists, as in Electron). */
export function mediaOptions(variant: Variant) {
	return {
		colorScheme: variant.appearance ?? 'light',
		reducedMotion: variant.motion === 'full' ? ('no-preference' as const) : ('reduce' as const),
		forcedColors: variant.contrast === 'forced' ? ('active' as const) : ('none' as const),
		contrast: variant.contrast === 'more' ? ('more' as const) : ('no-preference' as const)
	};
}

/** Context options for a device and a variant (the parts Playwright emulates itself). */
export function contextOptions(device: Device, variant: Variant) {
	return {
		viewport: { width: device.width, height: device.height },
		deviceScaleFactor: device.scale,
		isMobile: device.mobile ?? false,
		hasTouch: device.touch ?? false,
		userAgent: device.userAgent,
		...mediaOptions(variant),
		locale: variant.locale,
		timezoneId: variant.timezone,
		offline: variant.network === 'offline',
		serviceWorkers: 'block' as const
	};
}

/**
 * Watches a page's requests so readiness can wait for the network to go quiet. Long-lived connections
 * (WebSockets, event streams) never finish and are left out; so is anything still open after 10 s (long polling).
 */
export class NetworkWatch {
	private open = new Map<Request, number>();
	private lastChange = Date.now();
	readonly failures: Finding[] = [];
	readonly consoleErrors: Finding[] = [];
	/** Everything the page does, for the run's logs and for sessions. */
	readonly log = new LogBook();

	constructor(
		page: Page,
		private blocked: (url: string) => boolean
	) {
		recordPage(page, this.log, blocked);
		page.on('request', (request) => {
			if (['websocket', 'eventsource'].includes(request.resourceType())) return;
			this.open.set(request, Date.now());
			this.lastChange = Date.now();
		});
		const done = (request: Request) => {
			if (this.open.delete(request)) this.lastChange = Date.now();
		};
		page.on('requestfinished', (request) => {
			done(request);
			// Rejects when the page has gone meanwhile; that is no finding, and must not be an unhandled rejection.
			request.response().then(
				(response) => {
					if (response && response.status() >= 400 && !this.blocked(request.url())) {
						this.failures.push({
							check: 'network',
							severity: response.status() >= 500 ? 'error' : 'warning',
							message: `${request.method()} ${shortUrl(request.url())} answered ${response.status()}.`
						});
					}
				},
				() => {}
			);
		});
		page.on('requestfailed', (request) => {
			done(request);
			const reason = request.failure()?.errorText ?? 'failed';
			if (this.blocked(request.url()) || /ERR_ABORTED|cancelled/i.test(reason)) return;
			this.failures.push({
				check: 'network',
				severity: 'error',
				message: `${request.method()} ${shortUrl(request.url())} failed: ${reason}.`
			});
		});
		page.on('console', (message) => {
			if (message.type() !== 'error') return;
			this.consoleErrors.push({
				check: 'console',
				severity: 'error',
				message: message.text().slice(0, 300)
			});
		});
		page.on('pageerror', (error) => {
			this.consoleErrors.push({
				check: 'console',
				severity: 'error',
				message: `Uncaught: ${error.message.slice(0, 300)}`
			});
		});
	}

	/** Forget everything before a new navigation. */
	reset(): void {
		this.open.clear();
		this.failures.length = 0;
		this.consoleErrors.length = 0;
		this.lastChange = Date.now();
	}

	/** What is still open, shortened, for a message. */
	openRequests(): string[] {
		return [...this.open.keys()]
			.slice(0, 3)
			.map((request) => `${request.method()} ${shortUrl(request.url())}`);
	}

	quietFor(): number {
		const now = Date.now();
		for (const [request, since] of this.open) if (now - since > 10_000) this.open.delete(request);
		return this.open.size ? 0 : now - this.lastChange;
	}
}

/** `over` laid over `base`: its settings win, and its selectors add to the base's. */
export function layRule(base: ReadyRule, over: ReadyRule | undefined): ReadyRule {
	if (!over) return base;
	return {
		...base,
		...over,
		visible: [...(base.visible ?? []), ...(over.visible ?? [])],
		gone: [...(base.gone ?? []), ...(over.gone ?? [])]
	};
}

/** The readiness rule for a path: the general one, with the first matching route rule laid over it. */
export function readyRuleFor(path: string, ready: WebConfig['ready']): ReadyRule {
	const { routes, ...base } = ready ?? {};
	const route = Object.entries(routes ?? {}).find(([pattern]) => globToRegExp(pattern).test(path));
	return layRule(base, route?.[1]);
}

export function globToRegExp(glob: string): RegExp {
	const source = glob
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*\*/g, '\uE000')
		.replace(/\*/g, '[^/]*')
		.replace(/\uE000/g, '.*')
		.replace(/\?/g, '.');
	return new RegExp(`^${source}$`);
}

/**
 * Waits until the screen has settled: the network quiet, fonts loaded, spinners gone, wanted content shown, the
 * app's own condition true, then two frames painted. If it gives up, it says what it was still waiting for (the
 * screenshot is taken anyway).
 */
export async function waitReady(
	page: Page,
	watch: NetworkWatch,
	rule: ReadyRule
): Promise<{ ready: boolean; waitingFor?: string }> {
	const timeout = rule.timeout ?? 15_000;
	const idle = rule.idle ?? 300;
	const deadline = Date.now() + timeout;
	const check = async (): Promise<string | undefined> => {
		if (idle > 0 && watch.quietFor() < idle)
			return `the network (${watch.openRequests().join(', ') || 'requests just finished'})`;
		return page
			.evaluate(
				async ({ visible, gone, when }) => {
					if (document.readyState !== 'complete') return 'the page to finish loading';
					if (document.fonts && document.fonts.status !== 'loaded') return 'fonts to load';
					const isShown = (element: Element) => {
						const box = element.getBoundingClientRect();
						const style = getComputedStyle(element);
						return (
							box.width > 0 &&
							box.height > 0 &&
							style.visibility !== 'hidden' &&
							style.display !== 'none'
						);
					};
					for (const selector of gone) {
						for (const element of document.querySelectorAll(selector))
							if (isShown(element)) return `"${selector}" to go away`;
					}
					for (const selector of visible) {
						const element = document.querySelector(selector);
						if (!element || !isShown(element)) return `"${selector}" to show`;
					}
					if (when && !(0, eval)(when)) return `${when} to be true`;
					return undefined;
				},
				{ visible: rule.visible ?? [], gone: rule.gone ?? [], when: rule.when ?? '' }
			)
			.catch((error: Error) => `the page (${error.message.split('\n')[0]})`);
	};
	let waitingFor: string | undefined = 'the page';
	while (Date.now() < deadline) {
		waitingFor = await check();
		if (!waitingFor) break;
		await page.waitForTimeout(50);
	}
	// Two painted frames, so what was just laid out is on screen.
	await page
		.evaluate(
			() =>
				new Promise<void>((done) =>
					requestAnimationFrame(() => requestAnimationFrame(() => done()))
				)
		)
		.catch(() => {});
	return waitingFor ? { ready: false, waitingFor } : { ready: true };
}

export async function readPage(
	page: Page,
	watch: NetworkWatch,
	checks: string[],
	device: Device
): Promise<Finding[]> {
	const findings: Finding[] = [];
	if (checks.includes('console')) {
		// The browser logs every failed request too; the network check says it better, with the address.
		const network = checks.includes('network');
		findings.push(
			...watch.consoleErrors.filter(
				(finding) => !(network && finding.message.startsWith('Failed to load resource'))
			)
		);
	}
	if (checks.includes('network')) findings.push(...watch.failures);
	const pageChecks = checks.filter((name) => (PAGE_CHECKS as readonly string[]).includes(name));
	if (pageChecks.length) {
		findings.push(
			...(await page
				.evaluate(inPage, { checks: pageChecks, touch: device.touch ?? false, width: device.width })
				.catch(() => []))
		);
	}
	if (checks.includes('a11y')) findings.push(...(await axe(page)));
	return findings;
}

/** axe-core, if it is installed: serious and critical violations only, one finding per rule. */
async function axe(page: Page): Promise<Finding[]> {
	let source: string;
	try {
		source = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
	} catch {
		return [
			{
				check: 'a11y',
				severity: 'info',
				message: 'axe-core is not installed, so accessibility was not checked (npm i -D axe-core).'
			}
		];
	}
	await page.addScriptTag({ content: source });
	const violations = await page.evaluate(async () => {
		// @ts-expect-error axe is injected above
		const result = await window.axe.run(document, { resultTypes: ['violations'] });
		return result.violations.map(
			(v: { id: string; impact: string; help: string; nodes: { target: string[] }[] }) => ({
				id: v.id,
				impact: v.impact,
				help: v.help,
				where: v.nodes
					.slice(0, 3)
					.map((node) => node.target.join(' '))
					.join(', '),
				count: v.nodes.length
			})
		);
	});
	return (
		violations as { id: string; impact: string; help: string; where: string; count: number }[]
	)
		.filter((v) => v.impact === 'serious' || v.impact === 'critical')
		.map((v) => ({
			check: 'a11y',
			severity: v.impact === 'critical' ? ('error' as const) : ('warning' as const),
			message: `${v.help} (${v.id}, ${v.count} element${v.count === 1 ? '' : 's'}).`,
			where: v.where
		}));
}

export async function takePicture(
	page: Page,
	file: string,
	options: { fullPage?: boolean; mask?: string[] }
): Promise<{ width: number; height: number }> {
	const buffer = await page.screenshot({
		path: file,
		fullPage: options.fullPage ?? false,
		animations: 'disabled',
		caret: 'hide',
		scale: 'device',
		mask: (options.mask ?? []).map((selector) => page.locator(selector)),
		timeout: 20_000
	});
	return pngSize(buffer);
}

/** A PNG's size, from its header: a buffer, or a file (only its first 24 bytes are read). */
export function pngSize(png: Uint8Array | string): { width: number; height: number } {
	let buffer = png;
	if (typeof png === 'string') {
		buffer = Buffer.alloc(24);
		const fd = openSync(png, 'r');
		try {
			readSync(fd, buffer, 0, 24, 0);
		} finally {
			closeSync(fd);
		}
	}
	const bytes = buffer as Uint8Array;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Blocks and rewrites requests as the config says. */
export async function routeRequests(
	context: BrowserContext,
	web: WebConfig | undefined
): Promise<(url: string) => boolean> {
	const patterns = (web?.block ?? []).map(globToRegExp);
	const blocked = (url: string) => patterns.some((pattern) => pattern.test(url));
	if (patterns.length) {
		await context.route(
			(url) => blocked(url.href),
			(route) => route.abort('blockedbyclient')
		);
	}
	for (const { from, to } of web?.rewrite ?? []) {
		await context.route(
			(url) => url.href.startsWith(from),
			(route) => route.continue({ url: to + route.request().url().slice(from.length) })
		);
	}
	return blocked;
}

/** Where a screenshot goes: `<screen>/<device>.<variant>.png` in the run folder, whose folder is made here. */
export function imagePath(
	runDir: string,
	screen: string,
	device: string,
	variant: string
): { file: string; rel: string } {
	const rel = join(screen, `${device}.${variant}.png`);
	const file = join(runDir, rel);
	mkdirSync(dirname(file), { recursive: true });
	return { file, rel };
}
