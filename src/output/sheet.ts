/**
 * Contact sheets: every device and variant of one screen on one image, labelled, so a person or a model reads one
 * screenshot instead of twelve. Drawn as an HTML page in the browser facetshot already has, so there is no image library
 * to install.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import type { CellResult } from '../types.ts';

export interface SheetOptions {
	/** Width of the sheet in pixels. Default 1600 (about what vision models read at full detail). */
	width?: number;
	title?: string;
}

const escape = (text: string) =>
	text.replace(
		/[&<>"]/g,
		(char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] as string
	);

function sheetHtml(
	screen: string,
	cells: CellResult[],
	devices: string[],
	variants: string[],
	width: number
): string {
	const columns = variants.length;
	const gap = 12;
	const labelWidth = 112;
	const columnWidth = Math.floor((width - labelWidth - gap * (columns + 1)) / columns);
	const rows = devices
		.map((device) => {
			const row = variants
				.map((variant) => {
					const cell = cells.find((each) => each.device === device && each.variant === variant);
					if (!cell) return `<td></td>`;
					const changed = cell.diff && cell.diff.ratio > 0;
					const issues = (cell.findings ?? []).filter(
						(finding) => finding.severity !== 'info'
					).length;
					const badges = [
						changed ? `<b class="changed">changed ${(cell.diff!.ratio * 100).toFixed(1)}%</b>` : '',
						issues ? `<b class="issues">${issues} issue${issues === 1 ? '' : 's'}</b>` : '',
						cell.readyTimedOut ? `<b class="slow">not settled</b>` : ''
					].join('');
					const body =
						cell.status === 'ok' && cell.image
							? `<img src="${escape(cell.image)}">`
							: `<div class="fail">${escape(cell.status === 'skipped' ? 'skipped' : 'failed')}<small>${escape(cell.error ?? '')}</small></div>`;
					return `<td class="${changed ? 'is-changed' : ''}">${body}${badges ? `<div class="badges">${badges}</div>` : ''}</td>`;
				})
				.join('');
			return `<tr><th>${escape(device)}</th>${row}</tr>`;
		})
		.join('');
	const head = variants.map((variant) => `<th>${escape(variant)}</th>`).join('');
	return `<!doctype html><meta charset="utf-8"><style>
		* { box-sizing: border-box }
		body { margin: 0; padding: ${gap}px; background: #f4f4f5; color: #18181b; font: 13px/1.3 -apple-system, system-ui, sans-serif; width: ${width}px }
		h1 { font-size: 15px; margin: 0 0 ${gap}px }
		table { border-collapse: separate; border-spacing: ${gap}px 0; margin-left: -${gap}px }
		thead th { text-align: left; font-weight: 600; padding-bottom: 6px }
		tbody th { width: ${labelWidth - gap}px; text-align: right; vertical-align: top; font-weight: 600; padding-top: 4px }
		td { width: ${columnWidth}px; vertical-align: top; padding-bottom: ${gap}px; position: relative }
		img { display: block; max-width: ${columnWidth}px; max-height: ${Math.round(columnWidth * 0.9)}px; outline: 1px solid #d4d4d8 }
		td.is-changed img { outline: 3px solid #e11d48 }
		.fail { width: ${columnWidth}px; padding: 10px; background: #fee2e2; color: #991b1b; font-weight: 600 }
		.fail small { display: block; font-weight: 400; margin-top: 4px; word-break: break-word }
		.badges { display: flex; gap: 4px; margin-top: 4px }
		.badges b { font-size: 11px; padding: 1px 5px; border-radius: 4px; color: white }
		.changed { background: #e11d48 } .issues { background: #d97706 } .slow { background: #52525b }
	</style><h1>${escape(screen)}</h1><table><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

/** Writes `<screen>.sheet.jpg` in the run folder and returns its path relative to the run. */
export async function drawSheet(
	browser: Browser,
	runDir: string,
	screen: string,
	cells: CellResult[],
	devices: string[],
	variants: string[],
	options: SheetOptions = {}
): Promise<string> {
	const width = options.width ?? 1600;
	const usedDevices = devices.filter((device) => cells.some((cell) => cell.device === device));
	const usedVariants = variants.filter((variant) => cells.some((cell) => cell.variant === variant));
	const htmlFile = join(runDir, `.${screen.replace(/\//g, '__')}.sheet.html`);
	writeFileSync(
		htmlFile,
		sheetHtml(options.title ?? screen, cells, usedDevices, usedVariants, width)
	);
	const page = await browser.newPage({ viewport: { width, height: 400 }, deviceScaleFactor: 1 });
	try {
		await page.goto(`file://${htmlFile}`, { waitUntil: 'load' });
		const rel = `${screen.replace(/\//g, '__')}.sheet.jpg`;
		await page.screenshot({ path: join(runDir, rel), fullPage: true, type: 'jpeg', quality: 85 });
		return rel;
	} finally {
		await page.close();
	}
}
