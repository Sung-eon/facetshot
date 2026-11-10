/**
 * Flows: a few steps to reach a state a URL can't (a menu open, a form half filled, an error shown), with a picture
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
import type { Page } from 'playwright';
import { UsageError } from './errors.ts';

export type Step =
	| { click: string }
	| { tap: string }
	| { hover: string }
	| { focus: string }
	| { fill: string; with: string }
	| { type: string }
	| { press: string }
	| { select: string; option: string }
	| { scroll: string | number }
	| { wait: string }
	| { gone: string }
	| { goto: string }
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
	'tap',
	'hover',
	'focus',
	'fill',
	'type',
	'press',
	'select',
	'scroll',
	'wait',
	'gone',
	'goto',
	'shot'
];

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
	const at = text.indexOf(':');
	const key = at > 0 ? text.slice(0, at) : '';
	const value = text.slice(at + 1);
	if (!KEYS.includes(key)) {
		throw new UsageError(
			`"${text}" isn't a step.`,
			`Write <step>:<value>, e.g. click:"role=button[name='Save']" or shot:saved. Steps: ${KEYS.join(', ')}.`
		);
	}
	if (key === 'fill' || key === 'select') {
		const split = value.lastIndexOf('=');
		if (split < 0)
			throw new UsageError(`"${text}" needs a value after "=": ${key}:<selector>=<text>.`);
		return key === 'fill'
			? { fill: value.slice(0, split), with: value.slice(split + 1) }
			: { select: value.slice(0, split), option: value.slice(split + 1) };
	}
	if (key === 'scroll' && /^-?\d+$/.test(value)) return { scroll: Number(value) };
	return { [key]: value } as Step;
}

/**
 * Steps given inline (`--do`, MCP `steps`) become a flow file per target, so they run exactly like a written flow.
 * Named by their content: the same steps make the same file and the same screen names run after run.
 */
export function inlineFlow(start: string, steps: Step[], stateDir: string): string {
	const text = stringify({ start, steps });
	const hash = createHash('sha256').update(text).digest('hex').slice(0, 8);
	// The file is named after its start, so the pictures are `<start>.<shot>`; the folder keeps different steps apart.
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

/** The pictures a flow takes, in order: each `shot` step, or the end of the flow if it has none. */
export function shotNames(flow: Flow): string[] {
	const names = flow.steps
		.filter((step): step is { shot: string } => 'shot' in step)
		.map((step) => step.shot);
	return names.length ? names : ['end'];
}

/**
 * Plays a flow in a browser page. `onShot` is called at each `shot` step (and at the end if there are none) and is
 * expected to wait for readiness and take the picture.
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
			if ('click' in step) await page.locator(step.click).first().click({ timeout: 10_000 });
			else if ('tap' in step) await page.locator(step.tap).first().tap({ timeout: 10_000 });
			else if ('hover' in step) await page.locator(step.hover).first().hover({ timeout: 10_000 });
			else if ('focus' in step) await page.locator(step.focus).first().focus({ timeout: 10_000 });
			else if ('fill' in step)
				await page.locator(step.fill).first().fill(step.with, { timeout: 10_000 });
			else if ('type' in step) await page.keyboard.type(step.type);
			else if ('press' in step) await page.keyboard.press(step.press);
			else if ('select' in step)
				await page.locator(step.select).first().selectOption(step.option, { timeout: 10_000 });
			else if ('scroll' in step) {
				if (typeof step.scroll === 'number') await page.mouse.wheel(0, step.scroll);
				else await page.locator(step.scroll).first().scrollIntoViewIfNeeded({ timeout: 10_000 });
			} else if ('wait' in step)
				await page.locator(step.wait).first().waitFor({ state: 'visible', timeout: 15_000 });
			else if ('gone' in step)
				await page.locator(step.gone).first().waitFor({ state: 'hidden', timeout: 15_000 });
			else if ('goto' in step) await open(step.goto);
			else if ('shot' in step) {
				shots += 1;
				await onShot(step.shot);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
			throw new Error(`${where} (${JSON.stringify(step)}) didn't work: ${message}`, {
				cause: error
			});
		}
	}
	if (!shots) await onShot('end');
}
