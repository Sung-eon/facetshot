/**
 * What a session works: one screen kept open, a page in a browser or Electron, or a Mac app's window (a native Mac
 * app, or Tauri's real window). Each kind does steps, looks, and says where it is; the session around it keeps the
 * order, the logs and the steps that worked.
 */
import type { Cell, Config, Device, Finding, Variant } from './types.ts';
import { doStep, type Step, type StepHost } from './flows.ts';
import { withLock } from './engine/lock.ts';
import type { Runtime } from './engine/runtime.ts';
import { fillAddress, type RunContext } from './drivers/driver.ts';
import {
	addressOf,
	engineOf,
	navigate,
	newSession,
	WebDriver,
	type PageSession
} from './drivers/web.ts';
import {
	chooseMenu,
	ElectronDriver,
	launchApp,
	openInApp,
	sizeWindow
} from './drivers/electron.ts';
import { launchTauri, TauriDriver, tauriEngine, tauriMockScript } from './drivers/tauri.ts';
import {
	helper,
	isMacApp,
	macLauncher,
	prepareMac,
	shootMacWindow,
	type Launched
} from './drivers/macos.ts';
import { MacUi } from './drivers/mac-ui.ts';
import { readPage, readyRuleFor, waitReady } from './drivers/page.ts';
import { LogBook } from './logs.ts';
import type { LookOptions, OnScreen } from './session.ts';

/** What a look found, before the session adds its logs. */
export interface Look {
	image?: string;
	width?: number;
	height?: number;
	findings: Finding[];
	elements?: OnScreen[];
	tree?: string;
	unsettled?: string;
}

export interface Surface {
	readonly device: Device;
	readonly variant: Variant;
	/** Everything the screen logged since it opened. */
	readonly log: LogBook;
	/** What `@x,y` and the screenshot's size are measured in. */
	readonly units: 'CSS pixels' | 'points';
	/** Runs work under what this kind shares with runs: the browser pool, or the one Mac window at a time. */
	guard<T>(work: () => Promise<T>): Promise<T>;
	url(): string;
	title(): Promise<string>;
	/** Shows an address, as the first screen or a `goto`. */
	open(address: string): Promise<void>;
	/** Does a step (not `shot`) and returns it as a saved flow should keep it. */
	step(step: Step): Promise<Step>;
	/** Looks at the screen: a screenshot into `image` when given, what's on it, and anything unsettled. */
	look(options: LookOptions, image: string | undefined): Promise<Look>;
}

type Kind = 'web' | 'electron' | 'tauri' | 'mac' | 'tauri-window';

/** What a session can open a cell in, if anything. */
export function sessionKind(cell: Cell, config: Config): Kind | undefined {
	if (cell.device.platform === 'web' && cell.target.kind === 'web') return 'web';
	if (cell.device.platform !== 'window' || cell.target.kind !== 'app') return undefined;
	if (config.desktop?.kind === 'electron') return 'electron';
	if (config.desktop?.kind === 'tauri')
		return tauriEngine(config.desktop) === 'webkit' ? 'tauri' : 'tauri-window';
	if (isMacApp(config)) return 'mac';
	return undefined;
}

/** Opens the cell's screen the way its kind is opened; what has to be stopped later goes into `closers`. */
export async function openSurface(
	cell: Cell,
	ctx: RunContext,
	runtime: Runtime,
	closers: (() => Promise<void>)[]
): Promise<Surface> {
	const config = ctx.config;
	const values = ctx.values;
	const desktop = config.desktop;
	switch (sessionKind(cell, config)) {
		case 'electron': {
			const driver = new ElectronDriver();
			await driver.prepare([cell], ctx);
			const { app, page, watch, close } = await launchApp(
				ctx,
				driver.launchInfo,
				cell.variant,
				cell.device.scale
			);
			closers.push(close);
			await sizeWindow(app, page, cell.device);
			return new PageSurface({ page, watch, device: cell.device, variant: cell.variant }, ctx, {
				open: (address) =>
					openInApp(app, page, desktop!.navigate, fillAddress(cell, address, values), values),
				menu: (path) => chooseMenu(app, path)
			});
		}
		case 'tauri': {
			const driver = new TauriDriver();
			await driver.prepare([cell], ctx);
			const browser = await runtime.browser('webkit', cell.variant.appearance);
			const made = await newSession(
				browser,
				// A window is not a phone: whatever the device says, no mobile emulation or touch.
				{ ...cell.device, mobile: false, touch: false },
				cell.variant,
				config.web,
				{
					baseURL: driver.frontendURL,
					root: ctx.root,
					initScript: tauriMockScript(desktop!.invoke)
				}
			);
			closers.push(made.close);
			return new PageSurface(
				made.session,
				ctx,
				{
					open: (address) =>
						navigate(made.session.page, fillAddress(cell, address, values), driver.frontendURL)
				},
				driver.frontendURL
			);
		}
		case 'mac': {
			const mac = await prepareMac(ctx);
			const { launch } = macLauncher(mac, cell.device, cell.variant, ctx);
			const log = new LogBook();
			let running: Launched | undefined;
			closers.push(async () => running?.stop());
			// A native Mac app is sent to a screen at launch, so each address is a fresh launch.
			return new MacSurface(cell, ctx, mac.finder, log, {
				current: () => running,
				open: async (address) => {
					await running?.stop();
					running = undefined;
					running = await launch(fillAddress(cell, address, values), log);
				}
			});
		}
		case 'tauri-window': {
			const driver = new TauriDriver();
			await driver.prepare([cell], ctx);
			const log = new LogBook();
			const window = await launchTauri(driver.appPath, cell.device, cell.variant, ctx, log);
			closers.push(() => window.launched.stop());
			return new MacSurface(cell, ctx, await helper(ctx.log), log, {
				current: () => window.launched,
				open: (address) => window.open(fillAddress(cell, address, values))
			});
		}
		default: {
			const driver = new WebDriver();
			await driver.prepare([cell], ctx);
			const browser = await runtime.browser(engineOf(config, cell.device), cell.variant.appearance);
			const made = await newSession(browser, cell.device, cell.variant, config.web, {
				baseURL: driver.url,
				root: ctx.root,
				stateDir: ctx.stateDir
			});
			closers.push(made.close);
			return new PageSurface(
				made.session,
				ctx,
				{
					open: (address) =>
						navigate(made.session.page, fillAddress(cell, address, values), driver.url)
				},
				driver.url
			);
		}
	}
}

/** A page: in a browser, an Electron window, or a Tauri frontend. Read through Playwright's accessibility snapshot. */
class PageSurface implements Surface {
	readonly units = 'CSS pixels';

	constructor(
		private session: PageSession,
		private ctx: RunContext,
		private host: StepHost,
		/** The address paths are opened under, so readiness rules match paths as targets name them. */
		private base?: string
	) {}

	get device(): Device {
		return this.session.device;
	}
	get variant(): Variant {
		return this.session.variant;
	}
	get log(): LogBook {
		return this.session.watch.log;
	}

	guard<T>(work: () => Promise<T>): Promise<T> {
		return this.ctx.pools.web.run(work);
	}

	url(): string {
		return this.session.page.url();
	}

	title(): Promise<string> {
		return this.session.page.title().catch(() => '');
	}

	async open(address: string): Promise<void> {
		this.session.watch.reset();
		await this.host.open(address);
	}

	async step(step: Step): Promise<Step> {
		// Worked out before the step: a click may take the element away.
		const kept = await lasting(this.session.page, step);
		await doStep(this.session.page, step, { ...this.host, open: (address) => this.open(address) });
		return kept;
	}

	async look(options: LookOptions, image: string | undefined): Promise<Look> {
		const { page, watch, device } = this.session;
		const address = addressOf(page.url(), this.base);
		const settled = await waitReady(page, watch, {
			...readyRuleFor(address, this.ctx.config.web?.ready),
			timeout: 8000
		});
		const findings = await readPage(page, watch, ['console', 'network'], device);
		watch.failures.length = 0;
		watch.consoleErrors.length = 0;
		let picture: Pick<Look, 'image' | 'width' | 'height'> = {};
		if (image) {
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
		return {
			...picture,
			findings,
			elements: options.elements
				? onScreen(snapshot, page.viewportSize() ?? { width: 1e5, height: 1e5 })
				: undefined,
			tree: options.tree ? snapshot.replace(/ \[box=[^\]]*\]/g, '') : undefined,
			unsettled: settled.ready ? undefined : settled.waitingFor
		};
	}
}

/** A Mac app's window, read and worked through Accessibility; its screenshot is the window's own. */
class MacSurface implements Surface {
	readonly units = 'points';
	private ui: MacUi | undefined;
	private address = '/';
	private windowTitle = '';

	constructor(
		private cell: Cell,
		private ctx: RunContext,
		private finder: string,
		readonly log: LogBook,
		private app: { current: () => Launched | undefined; open: (address: string) => Promise<void> }
	) {}

	get device(): Device {
		return this.cell.device;
	}
	get variant(): Variant {
		return this.cell.variant;
	}

	guard<T>(work: () => Promise<T>): Promise<T> {
		// The pointer and keyboard are the screen's: one Mac window at a time, sessions and runs alike.
		return withLock(this.ctx.locks.macWindow, `facetshot session in ${this.ctx.root}`, work, {
			onWait: this.ctx.log,
			poll: 1000
		});
	}

	url(): string {
		return `app:${this.address}`;
	}

	async title(): Promise<string> {
		return this.windowTitle;
	}

	private running(): Launched {
		const running = this.app.current();
		if (!running) throw new Error("The app isn't running.");
		return running;
	}

	private async mac(): Promise<MacUi> {
		const pid = this.running().pid;
		if (this.ui?.pid !== pid) this.ui = await MacUi.of(pid, this.ctx.log);
		return this.ui;
	}

	async open(address: string): Promise<void> {
		await this.app.open(address);
		this.address = address.replace(/^app:/, '');
	}

	async step(step: Step): Promise<Step> {
		if ('goto' in step) {
			await this.open(step.goto);
			return step;
		}
		const ui = await this.mac();
		const kept = ui.lasting(step);
		await ui.step(step);
		return kept;
	}

	async look(options: LookOptions, image: string | undefined): Promise<Look> {
		const ui = await this.mac();
		let unsettled: string | undefined;
		let size: Pick<Look, 'width' | 'height'> = {};
		if (image) {
			const shot = await shootMacWindow(this.finder, this.running(), image);
			if (shot.timedOut) unsettled = 'the window to stop changing';
			const window = await ui.window();
			// The image has the screen's pixels; steps take points, so the size is said in points.
			size = { width: window.width, height: window.height };
		}
		let elements: OnScreen[] | undefined;
		let tree: string | undefined;
		if (options.elements || options.tree) {
			const screen = await ui.screen();
			this.windowTitle = screen.nodes.find((node) => node.role === 'AXWindow')?.name ?? '';
			if (options.elements) elements = ui.list(screen);
			if (options.tree) tree = ui.tree(screen);
		}
		return { ...(image ? { image } : {}), ...size, findings: [], elements, tree, unsettled };
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
