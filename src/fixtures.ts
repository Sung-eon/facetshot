/**
 * Test data: made by the project's `fixtures.setup`, written down as it is made, and removed afterwards — even if the
 * run that made it crashed, because the next run finds it in the ledger and removes it first.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FixtureContext } from './types.ts';
import type { RunContext } from './drivers/driver.ts';
import { explain } from './errors.ts';
import { alive } from './engine/procs.ts';

interface LedgerEntry {
	owner: number;
	runId: string;
	kind: string;
	id: string;
	extra?: Record<string, unknown>;
}

function ledgerPath(ctx: RunContext): string {
	return join(ctx.stateDir, 'fixtures.ledger.json');
}

function readLedger(ctx: RunContext): LedgerEntry[] {
	const file = ledgerPath(ctx);
	if (!existsSync(file)) return [];
	try {
		return JSON.parse(readFileSync(file, 'utf8')) as LedgerEntry[];
	} catch {
		return [];
	}
}

function writeLedger(ctx: RunContext, entries: LedgerEntry[]): void {
	mkdirSync(ctx.stateDir, { recursive: true });
	writeFileSync(ledgerPath(ctx), JSON.stringify(entries, null, '\t'));
}

function fixtureContext(ctx: RunContext, runId: string): FixtureContext {
	return {
		runId,
		label: `facetshot-${runId}`,
		services: ctx.services,
		record(kind, id, extra) {
			writeLedger(ctx, [...readLedger(ctx), { owner: process.pid, runId, kind, id, extra }]);
		},
		log: ctx.log
	};
}

async function removeEntries(ctx: RunContext, entries: LedgerEntry[]): Promise<void> {
	const remove = ctx.config.fixtures?.remove;
	if (!remove || !entries.length) return;
	const gone = new Set<LedgerEntry>();
	// Newest first: things made later usually sit inside things made earlier.
	for (const entry of [...entries].reverse()) {
		try {
			await remove(
				{ kind: entry.kind, id: entry.id, extra: entry.extra },
				fixtureContext(ctx, entry.runId)
			);
			gone.add(entry);
		} catch (error) {
			ctx.log(`Couldn't remove ${entry.kind} ${entry.id}: ${explain(error)}`);
		}
	}
	writeLedger(
		ctx,
		readLedger(ctx).filter(
			(entry) => ![...gone].some((g) => g.id === entry.id && g.kind === entry.kind)
		)
	);
}

/**
 * Removes what crashed runs left, then makes this run's data (or reuses the data the daemon already made). Removal
 * is tied to the runtime: when it closes, the data goes.
 */
export async function prepareFixtures(ctx: RunContext): Promise<Record<string, string>> {
	const fixtures = ctx.config.fixtures;
	if (!fixtures?.setup) return {};
	const key = `${ctx.root}\u0000fixtures`;
	const kept = ctx.runtime.memo.get(key) as
		{ values: Record<string, string>; runId: string } | undefined;
	if (kept && fixtures.reuse !== false) return kept.values;

	const leftovers = readLedger(ctx).filter((entry) => !alive(entry.owner));
	if (leftovers.length) {
		ctx.log(
			`Removing test data left by an earlier run (${leftovers.length} item${leftovers.length === 1 ? '' : 's'})…`
		);
		await removeEntries(ctx, leftovers);
	}
	ctx.log('Making test data…');
	const values = await fixtures.setup(fixtureContext(ctx, ctx.runId));
	const runId = ctx.runId;
	const remove = async () => {
		ctx.log(`Removing test data of ${runId}…`);
		await removeEntries(
			ctx,
			readLedger(ctx).filter((entry) => entry.runId === runId)
		);
	};
	// Kept: made once and removed when the runtime closes. Not kept: this run's own, removed when it ends (in the
	// daemon, waiting for the runtime would pile up every run's data until the daemon stops).
	if (fixtures.reuse === false) ctx.atEnd(remove);
	else {
		ctx.runtime.memo.set(key, { values, runId });
		ctx.runtime.onClose('test data', remove);
	}
	return values;
}

/** Removes every recorded item, whoever made it, if that process is gone. For `facetshot clean`. */
export async function removeAllFixtures(ctx: RunContext): Promise<number> {
	const entries = readLedger(ctx).filter(
		(entry) => !alive(entry.owner) || entry.owner === process.pid
	);
	await removeEntries(ctx, entries);
	return entries.length;
}
