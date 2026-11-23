/**
 * Pixel differences between this run and an earlier one (or a saved baseline): pixelmatch at a fixed threshold of
 * 0.1, with anti-aliased pixels left out. Any changed pixel counts; docs/comparing.md describes the rule.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface DiffResult {
	/** Share of pixels that differ, 0…1. 1 when the sizes differ. */
	ratio: number;
	/** The diff image, relative to the run folder (only written when something changed). */
	image?: string;
	note?: string;
}

/**
 * Compares two screenshots. Identical files (most of them) are answered here; the rest are decoded and compared in a
 * worker thread, because three full bitmaps of a tall page take hundreds of megabytes and seconds of CPU, and the
 * background helper must keep serving other runs and sessions meanwhile.
 */
export async function diffImages(
	current: string,
	previous: string,
	runDir: string,
	rel: string
): Promise<DiffResult> {
	if (!existsSync(previous)) return { ratio: 1, note: 'new: nothing to compare with' };
	// Most screenshots don't change, and the same pixels make the same file: no need to decode them.
	if (readFileSync(previous).equals(readFileSync(current))) return { ratio: 0 };
	return inWorker({ current, previous, runDir, rel });
}

export interface DiffJob {
	current: string;
	previous: string;
	runDir: string;
	rel: string;
}

let worker: Worker | undefined;
let nextId = 0;
const waiting = new Map<
	number,
	{ done: (result: DiffResult) => void; fail: (error: Error) => void }
>();

function inWorker(job: DiffJob): Promise<DiffResult> {
	if (!worker) {
		const started = new Worker(new URL('./diff-worker.ts', import.meta.url).href);
		started.onmessage = (
			event: MessageEvent<{ id: number; result?: DiffResult; error?: string }>
		) => {
			const { id, result, error } = event.data;
			const entry = waiting.get(id);
			waiting.delete(id);
			if (!entry) return;
			if (result) entry.done(result);
			else entry.fail(new Error(error ?? 'The image comparison failed.'));
			// Nothing left to compare: the thread and its memory go; the next comparison starts another.
			if (!waiting.size && worker === started) {
				worker = undefined;
				void started.terminate();
			}
		};
		started.onerror = (event) => {
			if (worker === started) worker = undefined;
			for (const [id, entry] of waiting) {
				waiting.delete(id);
				entry.fail(new Error(event.message || 'The image comparison stopped.'));
			}
		};
		worker = started;
	}
	const id = nextId++;
	const promise = new Promise<DiffResult>((done, fail) => waiting.set(id, { done, fail }));
	worker.postMessage({ id, job });
	return promise;
}

/** The comparison itself, synchronous: what the worker runs. */
export function compareImages({ current, previous, runDir, rel }: DiffJob): DiffResult {
	const before = readFileSync(previous);
	const after = readFileSync(current);
	if (before.equals(after)) return { ratio: 0 };
	const a = PNG.sync.read(before);
	const b = PNG.sync.read(after);
	if (a.width !== b.width || a.height !== b.height) {
		return { ratio: 1, note: `size changed from ${a.width}×${a.height} to ${b.width}×${b.height}` };
	}
	const out = new PNG({ width: a.width, height: a.height });
	const different = pixelmatch(a.data, b.data, out.data, a.width, a.height, {
		threshold: 0.1,
		includeAA: false
	});
	const ratio = different / (a.width * a.height);
	if (!different) return { ratio: 0 };
	const image = rel.replace(/\.png$/, '.diff.png');
	writeFileSync(join(runDir, image), PNG.sync.write(out));
	return { ratio, image };
}
