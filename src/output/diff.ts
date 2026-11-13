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

export function diffImages(
	current: string,
	previous: string,
	runDir: string,
	rel: string
): DiffResult {
	if (!existsSync(previous)) return { ratio: 1, note: 'new: nothing to compare with' };
	const before = readFileSync(previous);
	const after = readFileSync(current);
	// Most screenshots don't change, and the same pixels make the same file: no need to decode them.
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
