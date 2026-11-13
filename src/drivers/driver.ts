/**
 * What every driver (web, Storybook, iOS simulator, desktop window, Swift snapshots) implements, and the long-lived
 * runtime they share. A new platform is a new Driver; nothing else in facetshot needs to change.
 */
import type { LogGroup } from '../logs.ts';
import type { Cell, CellResult, Config, Variant } from '../types.ts';
import { firstLine, UsageError } from '../errors.ts';
import { fill, unfilled } from '../plan.ts';
import type { Pool } from '../engine/scheduler.ts';
import type { Runtime } from '../engine/runtime.ts';

export interface RunContext {
	config: Config;
	root: string;
	/** `<root>/.facetshot` (or the configured folder): logs, build stamps, the fixture ledger. */
	stateDir: string;
	runId: string;
	/** Where this run's screenshots go. */
	runDir: string;
	/** `{placeholder}` values: fixture ids, service URLs. */
	values: Record<string, string>;
	services: Record<string, { url: string }>;
	/** Which checks to run on each cell. */
	checks: string[];
	/** False for `facetshot check`: read the screens, take no screenshots. */
	images: boolean;
	runtime: Runtime;
	pools: { web: Pool; simulators: Pool };
	/** Machine-wide lock paths. */
	locks: { build: string; macWindow: string };
	/**
	 * Work to do when this run ends, whatever happened (apps this run opened). What should outlast the run inside
	 * the daemon goes to `runtime.onClose` instead.
	 */
	atEnd(close: () => Promise<void>): void;
	log(message: string): void;
	signal: AbortSignal;
	/** What each screenshot's page logged, a group per screenshot, written with the run. */
	logs: LogGroup[];
}

export interface Driver {
	readonly name: string;
	/** True if this driver takes the cell. The first driver that says yes gets it. */
	handles(cell: Cell, config: Config): boolean;
	/** Builds, servers, simulators: whatever must exist before the first screenshot. Throws if it can't be done. */
	prepare(cells: Cell[], ctx: RunContext): Promise<void>;
	/**
	 * After `prepare`, turns a pattern into the cells it stands for (`story:Button/*` → one cell per story), so
	 * progress and failures count real screenshots. Optional; cells come back unchanged without it.
	 */
	expand?(cells: Cell[], ctx: RunContext): Cell[];
	/** Takes the screenshots, reporting each cell as it finishes. Must report every cell it was given. */
	shoot(cells: Cell[], ctx: RunContext, report: (result: CellResult) => void): Promise<void>;
}

/** A result for one of a cell's screenshots (`screen` differs from the cell's in a flow); ok unless `fields` say otherwise. */
export function result(cell: Cell, fields: Partial<CellResult> = {}): CellResult {
	return {
		screen: cell.screen,
		target: cell.sceneId ?? cell.target.raw,
		device: cell.device.name,
		variant: cell.variant.name,
		status: 'ok',
		ms: 0,
		...fields
	};
}

export function failed(cell: Cell, error: string, ms = 0): CellResult {
	return result(cell, { status: 'failed', ms, error });
}

/** For a screenshot the run was stopped before. */
export const stopped = (cell: Cell) => failed(cell, 'Stopped before this screenshot.');

/** For `facetshot check` on a screen that has no page to read. */
export const unreadable = (cell: Cell, what: string) =>
	result(cell, {
		status: 'skipped',
		notes: [`facetshot check reads web pages; ${what} has nothing it can read.`]
	});

/** Items by key, in first-seen order: cells by device × variant, by model… */
export function groupBy<T>(items: T[], key: (item: T) => string): T[][] {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const name = key(item);
		const group = groups.get(name);
		if (group) group.push(item);
		else groups.set(name, [item]);
	}
	return [...groups.values()];
}

/** The cells of one device in one variant: what a browser context, a launch or a window size serves. */
export const byDeviceAndVariant = (cell: Cell) => `${cell.device.name}\u0000${cell.variant.name}`;

/** The cell's address with `{placeholders}` filled; throws what to do when one has no value. */
export function fillAddress(cell: Cell, address: string, values: Record<string, string>): string {
	const filled = fill(address, values);
	const missing = unfilled(filled);
	if (missing.length) {
		const them = missing.length === 1 ? 'it' : 'them';
		throw new UsageError(
			`"${cell.target.raw}" needs {${missing.join('}, {')}}, and nothing provided ${them}. ` +
				`Return ${them} from fixtures.setup in your config, or write the real value.`
		);
	}
	return filled;
}

/** A flow stopped by `error` after `taken` pictures: the rest fail with the reason, so the sheet shows where it stopped. */
export function failRest(
	cell: Cell,
	names: string[],
	taken: number,
	error: unknown,
	started: number,
	report: (result: CellResult) => void
): void {
	const message = error instanceof Error ? error.message : String(error);
	for (const name of names.slice(taken))
		report({ ...failed(cell, message, Date.now() - started), screen: `${cell.screen}.${name}` });
}

/**
 * Wraps `report` so the cells still unreported can be failed together when something ends a whole group (a launch
 * that died, a simulator that wouldn't boot). Every cell is reported exactly once.
 */
export function reporter(report: (result: CellResult) => void) {
	const reported = new Set<Cell>();
	return {
		report: (cell: Cell, result: CellResult) => {
			reported.add(cell);
			report(result);
		},
		failRest: (cells: Cell[], error: unknown) => {
			for (const cell of cells) if (!reported.has(cell)) report(failed(cell, firstLine(error)));
		}
	};
}

type Axis = Exclude<keyof Variant, 'name'>;
const AXES: Axis[] = [
	'appearance',
	'text',
	'contrast',
	'motion',
	'locale',
	'timezone',
	'direction',
	'persona',
	'network',
	'media'
];

/**
 * A note naming the variant's settings this platform doesn't apply, so a screenshot never claims more than it
 * shows. `applied` lists the axes the driver does set; a pair `[axis, value]` means only that value.
 */
export function notApplied(
	variant: Variant,
	applied: (Axis | [Axis, string])[],
	where: string
): string[] {
	const ignored = AXES.filter((axis) => {
		const value = variant[axis];
		if (!value || value === 'default') return false;
		return !applied.some((each) =>
			Array.isArray(each) ? each[0] === axis && each[1] === value : each === axis
		);
	});
	return ignored.length ? [`Not applied ${where}: ${ignored.join(', ')}.`] : [];
}
