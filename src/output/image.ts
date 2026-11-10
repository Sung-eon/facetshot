/**
 * Small image work without an image library: crop a PNG and scale it down so its longer side fits a limit. Box
 * filtering keeps text legible when shrinking, which is what a model reading a screenshot needs.
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

export interface Region {
	x: number;
	y: number;
	width: number;
	height: number;
}

export function readPng(file: string): PNG {
	return PNG.sync.read(readFileSync(file));
}

export function crop(image: PNG, region: Region): PNG {
	const x = Math.max(0, Math.min(image.width - 1, Math.round(region.x)));
	const y = Math.max(0, Math.min(image.height - 1, Math.round(region.y)));
	const width = Math.max(1, Math.min(image.width - x, Math.round(region.width)));
	const height = Math.max(1, Math.min(image.height - y, Math.round(region.height)));
	const out = new PNG({ width, height });
	for (let row = 0; row < height; row += 1) {
		const from = ((y + row) * image.width + x) * 4;
		image.data.copy(out.data, row * width * 4, from, from + width * 4);
	}
	return out;
}

/** Shrinks so the longer side is at most `max` pixels (never enlarges). */
export function fit(image: PNG, max: number): PNG {
	const factor = Math.max(image.width, image.height) / max;
	if (factor <= 1) return image;
	const width = Math.max(1, Math.round(image.width / factor));
	const height = Math.max(1, Math.round(image.height / factor));
	const out = new PNG({ width, height });
	for (let oy = 0; oy < height; oy += 1) {
		const y0 = Math.floor(oy * factor);
		const y1 = Math.min(image.height, Math.max(y0 + 1, Math.floor((oy + 1) * factor)));
		for (let ox = 0; ox < width; ox += 1) {
			const x0 = Math.floor(ox * factor);
			const x1 = Math.min(image.width, Math.max(x0 + 1, Math.floor((ox + 1) * factor)));
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			let n = 0;
			for (let y = y0; y < y1; y += 1) {
				for (let x = x0; x < x1; x += 1) {
					const i = (y * image.width + x) * 4;
					r += image.data[i];
					g += image.data[i + 1];
					b += image.data[i + 2];
					a += image.data[i + 3];
					n += 1;
				}
			}
			const o = (oy * width + ox) * 4;
			out.data[o] = r / n;
			out.data[o + 1] = g / n;
			out.data[o + 2] = b / n;
			out.data[o + 3] = a / n;
		}
	}
	return out;
}

export function encodePng(image: PNG): Buffer {
	return PNG.sync.write(image);
}
