import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { diffImages } from '../src/output/diff.ts';

function png(path: string, width: number, height: number, paint: (x: number, y: number) => number) {
	const image = new PNG({ width, height });
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const at = (y * width + x) * 4;
			const value = paint(x, y);
			image.data[at] = image.data[at + 1] = image.data[at + 2] = value;
			image.data[at + 3] = 255;
		}
	writeFileSync(path, PNG.sync.write(image));
}

describe('diffImages', () => {
	const dir = mkdtempSync(join(tmpdir(), 'facetshot-diff-'));
	png(join(dir, 'a.png'), 40, 30, () => 255);
	png(join(dir, 'same.png'), 40, 30, () => 255);
	png(join(dir, 'b.png'), 40, 30, (x, y) => (x < 10 && y < 10 ? 0 : 255));
	png(join(dir, 'wide.png'), 50, 30, () => 255);

	test('identical images are equal without a diff image', async () => {
		expect(await diffImages(join(dir, 'same.png'), join(dir, 'a.png'), dir, 'same.png')).toEqual({
			ratio: 0
		});
	});

	test('changed pixels are counted in a worker and drawn into a diff image', async () => {
		const result = await diffImages(join(dir, 'b.png'), join(dir, 'a.png'), dir, 'b.png');
		expect(result.ratio).toBeCloseTo(100 / 1200, 2);
		expect(result.image).toBe('b.diff.png');
		expect(existsSync(join(dir, 'b.diff.png'))).toBe(true);
	});

	test('several comparisons at once each get their own answer', async () => {
		const [changed, resized] = await Promise.all([
			diffImages(join(dir, 'b.png'), join(dir, 'a.png'), dir, 'b.png'),
			diffImages(join(dir, 'wide.png'), join(dir, 'a.png'), dir, 'wide.png')
		]);
		expect(changed.ratio).toBeGreaterThan(0);
		expect(resized).toMatchObject({ ratio: 1, note: 'size changed from 40×30 to 50×30' });
	});

	test('a missing earlier image is new', async () => {
		expect(
			(await diffImages(join(dir, 'a.png'), join(dir, 'none.png'), dir, 'a.png')).note
		).toContain('new');
	});
});
