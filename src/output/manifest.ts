/**
 * What a run hands back: `manifest.json` for programs and `summary.md` for people and models. The summary is short on
 * purpose — the sheets to open, what failed and why, and what the checks found — so it fits in a terminal or a tool
 * result without scrolling.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding, Manifest } from '../types.ts';
import { writeReport } from './report.ts';

export const MANIFEST_SCHEMA = 'https://unpkg.com/facetshot/schema/manifest.v1.json';

/** Writes the run's three readings: manifest.json (programs), summary.md (models, PRs), report.html (people). */
export function writeManifest(manifest: Manifest): void {
	writeFileSync(
		join(manifest.out, 'manifest.json'),
		JSON.stringify({ $schema: MANIFEST_SCHEMA, ...manifest }, null, '\t')
	);
	writeFileSync(join(manifest.out, 'summary.md'), markdown(manifest));
	writeReport(manifest);
}

/**
 * The summary as Markdown, with each sheet as an image: for a pull request, an issue, or a document. Image paths are
 * relative to the run folder unless `base` says where they will be served from.
 */
export function markdown(manifest: Manifest, base = ''): string {
	const text = summarize(manifest).split('\n');
	const sheets = manifest.screens
		.filter((screen) => screen.sheet)
		.map(
			(screen) =>
				`### ${screen.changed ? '△ ' : ''}${screen.screen}\n\n![${screen.screen}](${base}${encodeURI(screen.sheet!)})`
		);
	return `## facetshot\n\n${text[0]}\n\n\`\`\`\n${text.slice(1).join('\n').trim()}\n\`\`\`\n\n${sheets.join('\n\n')}\n`;
}

function seconds(ms: number): string {
	return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;
}

/** Groups the same finding across devices and variants into one line. */
export function groupFindings(
	manifest: Manifest
): { finding: Finding; screen: string; where: string[] }[] {
	const groups = new Map<string, { finding: Finding; screen: string; where: string[] }>();
	for (const cell of manifest.cells) {
		for (const finding of cell.findings ?? []) {
			if (finding.severity === 'info') continue;
			const key = `${cell.screen}\u0000${finding.check}\u0000${finding.message}\u0000${finding.where ?? ''}`;
			const group = groups.get(key) ?? { finding, screen: cell.screen, where: [] };
			// The same problem twice in one screenshot (two cut-off lines alike) is one place.
			if (!group.where.includes(`${cell.device}/${cell.variant}`))
				group.where.push(`${cell.device}/${cell.variant}`);
			groups.set(key, group);
		}
	}
	return [...groups.values()].sort(
		(a, b) => (a.finding.severity === 'error' ? -1 : 0) - (b.finding.severity === 'error' ? -1 : 0)
	);
}

export function summarize(
	manifest: Manifest,
	options: { absolute?: boolean; maxLines?: number } = {}
): string {
	const path = (rel: string) => (options.absolute ? join(manifest.out, rel) : rel);
	const { ok, failed, changed } = manifest.counts;
	const total = manifest.cells.length;
	const lines: string[] = [];
	const head = [
		`${ok}/${total} screenshots`,
		`${manifest.screens.length} screen${manifest.screens.length === 1 ? '' : 's'}`,
		`${manifest.devices.length} device${manifest.devices.length === 1 ? '' : 's'} × ${manifest.variants.length} variant${manifest.variants.length === 1 ? '' : 's'}`,
		`${seconds(manifest.ms)} (${seconds(manifest.prepareMs)} getting ready)`
	];
	if (changed !== undefined) head.push(`${changed} changed`);
	lines.push(head.join(' · '));
	for (const error of manifest.errors) lines.push(`✗ ${error}`);

	const sheets = manifest.screens.filter((screen) => screen.sheet);
	if (sheets.length) {
		lines.push('', 'Sheets:');
		for (const screen of sheets)
			lines.push(`  ${screen.changed ? '△ ' : ''}${path(screen.sheet!)}`);
	}

	const failures = manifest.cells.filter((cell) => cell.status === 'failed');
	if (failures.length) {
		lines.push('', `Failed (${failed}):`);
		const byReason = new Map<string, string[]>();
		for (const cell of failures) {
			const reason = cell.error ?? 'unknown';
			byReason.set(reason, [
				...(byReason.get(reason) ?? []),
				`${cell.screen} ${cell.device}/${cell.variant}`
			]);
		}
		for (const [reason, where] of byReason) {
			lines.push(
				`  ${where.length > 3 ? `${where.slice(0, 3).join(', ')} +${where.length - 3}` : where.join(', ')}: ${reason}`
			);
		}
	}

	const findings = groupFindings(manifest);
	if (findings.length) {
		lines.push('', `Found (${findings.length}):`);
		for (const { finding, screen, where } of findings.slice(0, 12)) {
			const at = where.length > 2 ? `${where.length} cells` : where.join(', ');
			lines.push(
				`  ${finding.severity === 'error' ? '✗' : '!'} ${screen} [${at}] ${finding.check}: ${finding.message}` +
					(finding.text ? ` "${finding.text}"` : '') +
					(finding.where ? ` — ${finding.where}` : '')
			);
		}
		if (findings.length > 12) lines.push(`  …and ${findings.length - 12} more in manifest.json`);
	}

	const unsettled = manifest.cells.filter((cell) => cell.readyTimedOut);
	if (unsettled.length) {
		const reasons = new Map<string, string[]>();
		for (const cell of unsettled) {
			const reason = cell.notes?.find((note) => note.startsWith('Not settled')) ?? 'Not settled.';
			reasons.set(reason, [...(reasons.get(reason) ?? []), cell.screen]);
		}
		lines.push('', `Taken before the screen settled (${unsettled.length}):`);
		for (const [reason, screens] of reasons)
			lines.push(`  ${[...new Set(screens)].join(', ')}: ${reason}`);
		lines.push(
			'  If the screenshot looks finished, relax web.ready for that route (e.g. idle: 0 for a page that polls).'
		);
	}
	lines.push('', `Report: ${path('report.html')}`, `Details: ${path('manifest.json')}`);
	if (manifest.logs) {
		const { count, errors, warnings } = manifest.logs;
		const tally = [
			errors && `${errors} error${errors === 1 ? '' : 's'}`,
			warnings && `${warnings} warning${warnings === 1 ? '' : 's'}`
		]
			.filter(Boolean)
			.join(', ');
		lines.push(
			`Logs: ${path(manifest.logs.text)} (${count} line${count === 1 ? '' : 's'}${tally ? `; ${tally}` : ''})`
		);
	}
	return lines.join('\n') + '\n';
}
