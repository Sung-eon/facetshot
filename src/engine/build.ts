/**
 * Builds that run only when something they read has changed. The hash of the inputs is kept next to the output, so
 * the next run (or another agent in the same checkout) skips straight to the screenshots.
 */
import { createHash } from 'node:crypto';
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

/** The command and environment a build step runs with, filled in: what differs between two settings of a checkout. */
function stepSettings(step: BuildStep, ctx: Pick<BuildContext, 'values'>): string[] {
	const env = Object.entries(step.env ?? {})
		.map(([key, value]) => `${key}=${fill(value, ctx.values)}`)
		.sort();
	return [fill(step.cmd, ctx.values), ...env];
}

/** What decides whether a build step must run again: its inputs' contents, its command and its environment. */
export function stepHash(step: BuildStep, ctx: Pick<BuildContext, 'root' | 'values'>): string {
	return inputsHash(ctx.root, step.inputs, stepSettings(step, ctx));
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

	const settingsFile = join(ctx.stateDir, 'builds', `${name}.settings`);
	const settings = createHash('sha1').update(stepSettings(step, ctx).join('\n')).digest('hex');
	const work = async () => {
		const before = existsSync(settingsFile) ? readFileSync(settingsFile, 'utf8') : undefined;
		if (output && existsSync(output) && before && before !== settings) {
			// Two settings of one checkout (another API address, another database) building into one folder take turns
			// overwriting it, and a server still serving the other's build starts serving this one.
			ctx.log(
				`Building ${name} over ${output}, which was built with another command or environment. If two settings of this checkout run at once, give each its own output folder (put what differs in build.output).`
			);
		}
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
		writeFileSync(settingsFile, settings);
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
