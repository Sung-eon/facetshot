/**
 * Flows: a few steps to reach a state a URL can't (a menu open, a form half filled, an error shown), with a screenshot
 * wherever a `shot` step says. Written in YAML or JSON:
 *
 *   start: /settings
 *   steps:
 *     - click: "role=button[name='Delete account']"
 *     - wait: "role=dialog"
 *     - shot: confirm-dialog
 *
 * Selectors are Playwright's (CSS, `text=`, `role=`), which read close to how a person describes the screen.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import type { Locator, Page } from 'playwright';
import { UsageError } from './errors.ts';

/**
 * A step. Where a step takes an element, it is a Playwright selector (CSS, `text=`, `role=`), a ref a session listed
 * (`e12`), or `@<x>,<y>` for a point on the screen in CSS pixels (the session's screenshots are in the same units).
 */
export type Step =
	| { click: string }
	| { dblclick: string }
	| { rightclick: string }
	| { tap: string }
	| { longpress: string }
	| { hover: string }
	| { focus: string }
	| { drag: string; to: string }
	| { fill: string; with: string }
	| { type: string }
	| { press: string }
	| { select: string; option: string }
	| { scroll: string | number; by?: number }
	| { wait: string }
	| { gone: string }
	| { goto: string }
	| { back: unknown }
	| { forward: unknown }
	| { reload: unknown }
	| { shot: string };

export interface Flow {
	name: string;
	start: string;
	steps: Step[];
	/** Where the flow came from, for messages. */
	file: string;
}

const KEYS = [
	'click',
	'dblclick',
	'rightclick',
	'tap',
	'longpress',
	'hover',
	'focus',
	'drag',
	'fill',
	'type',
	'press',
	'select',
	'scroll',
	'wait',
	'gone',
	'goto',
	'back',
	'forward',
	'reload',
	'shot'
];
/** Steps that need no value: `back`, not `back:`. */
const BARE = new Set(['back', 'forward', 'reload']);

export function loadFlow(file: string, root: string): Flow {
	const path = resolve(root, file);
	let data: unknown;
	try {
		data = parse(readFileSync(path, 'utf8'));
	} catch (error) {
		throw new UsageError(
			`Couldn't read the flow ${path}: ${error instanceof Error ? error.message : error}`
		);
	}
	const flow = data as Partial<Flow>;
	if (!flow || typeof flow.start !== 'string' || !Array.isArray(flow.steps)) {
		throw new UsageError(
			`${path} isn't a flow.`,
			'A flow has `start:` (where to begin, e.g. /settings) and `steps:` (a list).'
		);
	}
	flow.steps.forEach((step, index) => {
		const key = Object.keys(step ?? {}).find((name) => KEYS.includes(name));
		if (!key) {
			throw new UsageError(
				`Step ${index + 1} in ${path} isn't one I know: ${JSON.stringify(step)}.`,
				`Steps: ${KEYS.join(', ')}.`
			);
		}
	});
	return {
		name: flow.name ?? basename(path).replace(/\.(flow\.)?(ya?ml|json)$/, ''),
		start: flow.start,
		steps: flow.steps as Step[],
		file: path
	};
}

/**
 * One step written on a command line: `click:<selector>`, `fill:<selector>=<text>`, `select:<selector>=<option>`,
 * `press:Enter`, `scroll:600`, `wait:<selector>`, `shot:<name>`…
 */
export function parseStep(text: string): Step {
	if (BARE.has(text.trim())) return { [text.trim()]: true } as Step;
	const at = text.indexOf(':');
	const key = at > 0 ? text.slice(0, at) : '';
	const value = text.slice(at + 1);
	if (!KEYS.includes(key)) {
		throw new UsageError(
			`"${text}" isn't a step.`,
			`Write <step>:<value>, e.g. click:"role=button[name='Save']" or shot:saved. Steps: ${KEYS.join(', ')}.`
		);
	}
	if (key === 'fill' || key === 'select' || key === 'drag') {
		const split = value.lastIndexOf(key === 'drag' ? '>' : '=');
		if (split < 0)
			throw new UsageError(
				key === 'drag'
					? `"${text}" needs where to drop it: drag:<from>><to>.`
					: `"${text}" needs a value after "=": ${key}:<selector>=<text>.`
			);
		const [left, right] = [value.slice(0, split), value.slice(split + 1)];
		return key === 'fill'
			? { fill: left, with: right }
			: key === 'select'
				? { select: left, option: right }
				: { drag: left, to: right };
	}
	if (key === 'scroll' && /^-?\d+$/.test(value)) return { scroll: Number(value) };
	if (key === 'scroll' && /=-?\d+$/.test(value)) {
		const split = value.lastIndexOf('=');
		return { scroll: value.slice(0, split), by: Number(value.slice(split + 1)) };
	}
	return { [key]: value } as Step;
}

/**
 * Steps given inline (`--do`, MCP `steps`) become a flow file per target, so they run exactly like a written flow.
 * Named by their content: the same steps make the same file and the same screen names run after run.
 */
export function inlineFlow(start: string, steps: Step[], stateDir: string): string {
	const text = stringify({ start, steps });
	const hash = createHash('sha256').update(text).digest('hex').slice(0, 8);
	// The file is named after its start, so the screenshots are `<start>.<shot>`; the folder keeps different steps apart.
	const folder = join(stateDir, 'flows', hash);
	mkdirSync(folder, { recursive: true });
	const name =
		start
			.replace(/^[a-z]+:/, '')
			.replace(/[^\w]+/g, '-')
			.replace(/^-|-$/g, '') || 'home';
	const file = join(folder, `${name}.yaml`);
	writeFileSync(file, text);
	return file;
}

/** The screenshots a flow takes, in order: each `shot` step, or the end of the flow if it has none. */
export function shotNames(flow: Flow): string[] {
	const names = flow.steps
		.filter((step): step is { shot: string } => 'shot' in step)
		.map((step) => step.shot);
	return names.length ? names : ['end'];
}

/**
 * Plays a flow in a browser page. `onShot` is called at each `shot` step (and at the end if there are none) and is
 * expected to wait for readiness and take the screenshot.
 */
export async function playInPage(
	page: Page,
	flow: Flow,
	open: (path: string) => Promise<void>,
	onShot: (name: string) => Promise<void>
): Promise<void> {
	await open(flow.start);
	let shots = 0;
	for (const [index, step] of flow.steps.entries()) {
		const where = `step ${index + 1} of ${flow.name}`;
		try {
			if ('shot' in step) {
				shots += 1;
				await onShot(step.shot);
			} else await doStep(page, step, open);
		} catch (error) {
			const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
			throw new Error(`${where} (${JSON.stringify(step)}) didn't work: ${message}`, {
				cause: error
			});
		}
	}
	if (!shots) await onShot('end');
}

const TIMEOUT = 10_000;
/** The element a step names, or the point it names (`@x,y`). */
function aim(page: Page, target: string): { point: { x: number; y: number } } | { at: Locator } {
	const point = /^@\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(target.trim());
	if (point) return { point: { x: Number(point[1]), y: Number(point[2]) } };
	// A ref from a session's list (`e12`, `ref=e12`, `f1e3` in a frame), from Playwright's accessibility snapshot.
	return { at: locate(page, target) };
}

/**
 * An element named the way a person would: a ref from a session's list (`e12`, `f1e3` in a frame), the shortcuts
 * `label=`, `placeholder=`, `alt=`, `title=` and `testid=` (Playwright's getByLabel and friends), or any Playwright
 * selector (`text=`, `role=`, CSS).
 */
export function locate(page: Page, target: string): Locator {
	const trimmed = target.trim();
	const ref = /^(?:ref=)?((?:f\d+)?e\d+)$/.exec(trimmed);
	if (ref) return page.getByRef(ref[1]);
	const by = /^(label|placeholder|alt|title|testid)=(.+)$/.exec(trimmed);
	if (by) {
		const value = by[2].replace(/^(['"])(.*)\1$/, '$2');
		const found =
			by[1] === 'label'
				? page.getByLabel(value)
				: by[1] === 'placeholder'
					? page.getByPlaceholder(value)
					: by[1] === 'alt'
						? page.getByAltText(value)
						: by[1] === 'title'
							? page.getByTitle(value)
							: page.getByTestId(value);
		return found.first();
	}
	return page.locator(trimmed).first();
}

/** Does one step (anything but `shot`) in a page. `open` shows an address the way the driver does. */
export async function doStep(
	page: Page,
	step: Step,
	open: (address: string) => Promise<void>
): Promise<void> {
	const pointer = async (target: string, button: 'left' | 'right', count: number) => {
		const aimed = aim(page, target);
		if ('point' in aimed)
			await page.mouse.click(aimed.point.x, aimed.point.y, { button, clickCount: count });
		else if (count === 2) await aimed.at.dblclick({ button, timeout: TIMEOUT });
		else await aimed.at.click({ button, timeout: TIMEOUT });
	};
	const pointAt = async (target: string) => {
		const aimed = aim(page, target);
		if ('point' in aimed) return aimed.point;
		await aimed.at.scrollIntoViewIfNeeded({ timeout: TIMEOUT });
		const box = await aimed.at.boundingBox({ timeout: TIMEOUT });
		if (!box) throw new Error(`${target} isn't on screen.`);
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	};
	if ('click' in step) await pointer(step.click, 'left', 1);
	else if ('dblclick' in step) await pointer(step.dblclick, 'left', 2);
	else if ('rightclick' in step) await pointer(step.rightclick, 'right', 1);
	else if ('tap' in step) {
		const aimed = aim(page, step.tap);
		if ('point' in aimed) await page.touchscreen.tap(aimed.point.x, aimed.point.y);
		else await aimed.at.tap({ timeout: TIMEOUT });
	} else if ('longpress' in step) {
		const { x, y } = await pointAt(step.longpress);
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.waitForTimeout(800);
		await page.mouse.up();
	} else if ('hover' in step) {
		const aimed = aim(page, step.hover);
		if ('point' in aimed) await page.mouse.move(aimed.point.x, aimed.point.y);
		else await aimed.at.hover({ timeout: TIMEOUT });
	} else if ('focus' in step) {
		const aimed = aim(page, step.focus);
		if ('point' in aimed) throw new Error('focus takes an element, not a point.');
		await aimed.at.focus({ timeout: TIMEOUT });
	} else if ('drag' in step) {
		const from = await pointAt(step.drag);
		const to = await pointAt(step.to);
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(to.x, to.y, { steps: 12 });
		await page.mouse.up();
	} else if ('fill' in step) {
		const aimed = aim(page, step.fill);
		if ('point' in aimed) throw new Error('fill takes an element, not a point.');
		await aimed.at.fill(step.with, { timeout: TIMEOUT });
	} else if ('type' in step) await page.keyboard.type(step.type);
	else if ('press' in step) await page.keyboard.press(step.press);
	else if ('select' in step) {
		const aimed = aim(page, step.select);
		if ('point' in aimed) throw new Error('select takes an element, not a point.');
		await aimed.at.selectOption(step.option, { timeout: TIMEOUT });
	} else if ('scroll' in step) {
		if (typeof step.scroll === 'number') await page.mouse.wheel(0, step.scroll);
		else {
			const aimed = aim(page, step.scroll);
			if ('point' in aimed) {
				await page.mouse.move(aimed.point.x, aimed.point.y);
				await page.mouse.wheel(0, step.by ?? 400);
			} else if (step.by !== undefined) {
				await aimed.at.evaluate((element, by) => element.scrollBy(0, by), step.by);
			} else await aimed.at.scrollIntoViewIfNeeded({ timeout: TIMEOUT });
		}
	} else if ('wait' in step)
		await locate(page, step.wait).waitFor({ state: 'visible', timeout: 15_000 });
	else if ('gone' in step)
		await locate(page, step.gone).waitFor({ state: 'hidden', timeout: 15_000 });
	else if ('goto' in step) await open(step.goto);
	else if ('back' in step) await page.goBack({ waitUntil: 'load', timeout: 30_000 });
	else if ('forward' in step) await page.goForward({ waitUntil: 'load', timeout: 30_000 });
	else if ('reload' in step) await page.reload({ waitUntil: 'load', timeout: 30_000 });
}
