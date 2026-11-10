/**
 * Builds that run only when something they read has changed. The hash of the inputs is kept next to the output, so
 * the next run (or another agent in the same checkout) skips straight to the pictures.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { BuildStep } from '../types.ts';
import { inputsHash } from './cache.ts';
import { withLock } from './lock.ts';
import { runToEnd } from './procs.ts';
import { fill } from '../plan.ts';

export interface BuildContext {
	root: string;
	stateDir: string;
	values: Record<string, string>;
	/** A machine-wide lock for heavy builds, or undefined to build without one. */
	heavyLock?: string;
	log(message: string): void;
	signal?: AbortSignal;
}

export interface Built {
	hash: string;
	/** True when nothing had changed and the build was skipped. */
	cached: boolean;
	output?: string;
	ms: number;
}

/** What decides whether a build step must run again: its inputs' contents, its command and its environment. */
export function stepHash(step: BuildStep, ctx: Pick<BuildContext, 'root' | 'values'>): string {
	const env = Object.entries(step.env ?? {})
		.map(([key, value]) => `${key}=${fill(value, ctx.values)}`)
		.sort();
	return inputsHash(ctx.root, step.inputs, [fill(step.cmd, ctx.values), ...env]);
}

export async function ensureBuilt(
	name: string,
	step: BuildStep,
	ctx: BuildContext
): Promise<Built> {
	const started = Date.now();
	const hash = stepHash(step, ctx);
	const stamp = join(ctx.stateDir, 'builds', `${name}.hash`);
	const output = step.output ? resolve(ctx.root, fill(step.output, ctx.values)) : undefined;
	const fresh =
		existsSync(stamp) && readFileSync(stamp, 'utf8') === hash && (!output || existsSync(output));
	if (fresh) return { hash, cached: true, output, ms: Date.now() - started };

	const work = async () => {
		ctx.log(`Building ${name} (its inputs changed)…`);
		await runToEnd(step, {
			root: ctx.root,
			values: ctx.values,
			logFile: join(ctx.stateDir, 'logs', `build-${name}.log`),
			what: `The ${name} build`,
			signal: ctx.signal
		});
		mkdirSync(join(ctx.stateDir, 'builds'), { recursive: true });
		writeFileSync(stamp, hash);
	};
	if (step.heavy && ctx.heavyLock) {
		await withLock(ctx.heavyLock, `facetshot build ${name} in ${ctx.root}`, work, {
			onWait: ctx.log,
			signal: ctx.signal,
			poll: 5000
		});
	} else {
		await work();
	}
	return { hash, cached: false, output, ms: Date.now() - started };
}
