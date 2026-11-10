/**
 * `report.html`: the run for people. One page, no server and nothing to install: every screen as a grid of its
 * pictures (click one for full size), what the checks found next to it, and the changed pixels on a switch when the
 * run compared. It sits in the run's folder and uses the pictures beside it.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Manifest } from '../types.ts';
import { groupFindings } from './manifest.ts';

const escape = (text: string) =>
	text.replace(
		/[&<>"]/g,
		(char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] as string
	);

export function writeReport(manifest: Manifest): string {
	const findings = groupFindings(manifest);
	const sections = manifest.screens
		.map(({ screen, changed }) => {
			const cells = manifest.cells.filter((cell) => cell.screen === screen);
			const devices = manifest.devices.filter((device) =>
				cells.some((cell) => cell.device === device)
			);
			const variants = manifest.variants.filter((variant) =>
				cells.some((cell) => cell.variant === variant)
			);
			const rows = devices
				.map((device) => {
					const tds = variants.map((variant) => {
						const cell = cells.find((each) => each.device === device && each.variant === variant);
						if (!cell) return '<td></td>';
						if (cell.status !== 'ok' || !cell.image) {
							return `<td><div class="fail"><b>${cell.status}</b>${escape(cell.error ?? '')}</div></td>`;
						}
						const diff = cell.diff?.image ? ` data-diff="${escape(cell.diff.image)}"` : '';
						const badge = [
							cell.diff && cell.diff.ratio > 0
								? `<i class="changed">${(cell.diff.ratio * 100).toFixed(1)}% changed</i>`
								: '',
							cell.readyTimedOut ? '<i class="slow">not settled</i>' : '',
							cell.log?.errors
								? `<i class="changed">${cell.log.errors} error${cell.log.errors === 1 ? '' : 's'} logged</i>`
								: ''
						].join('');
						return `<td><a href="${escape(cell.image)}" target="_blank"><img loading="lazy" src="${escape(cell.image)}"${diff}></a>${badge}</td>`;
					});
					return `<tr><th>${escape(device)}</th>${tds.join('')}</tr>`;
				})
				.join('');
			const notes = findings
				.filter((group) => group.screen === screen)
				.map(
					({ finding, where }) =>
						`<li class="${finding.severity}"><b>${escape(finding.check)}</b> ${escape(finding.message)}${finding.text ? ` “${escape(finding.text)}”` : ''}${finding.where ? ` <code>${escape(finding.where)}</code>` : ''} <small>${escape(where.join(', '))}</small></li>`
				)
				.join('');
			return `<section id="${escape(screen)}"><h2>${changed ? '△ ' : ''}${escape(screen)}</h2>${notes ? `<ul>${notes}</ul>` : ''}<table><tr><td></td>${variants
				.map((variant) => `<th>${escape(variant)}</th>`)
				.join('')}</tr>${rows}</table></section>`;
		})
		.join('');
	const hasDiff = manifest.cells.some((cell) => cell.diff?.image);
	// The run's logs, folded away at the end; a huge log is linked rather than inlined.
	const logFile = manifest.logs ? join(manifest.out, manifest.logs.text) : undefined;
	const logs =
		logFile && existsSync(logFile)
			? `<section id="logs"><details><summary><b>Logs</b> <small>${manifest.logs!.count} lines, ${manifest.logs!.errors} errors, ${manifest.logs!.warnings} warnings · <a href="${escape(manifest.logs!.text)}">${escape(manifest.logs!.text)}</a> · <a href="${escape(manifest.logs!.json)}">${escape(manifest.logs!.json)}</a></small></summary>${
					statSync(logFile).size < 512 * 1024
						? `<pre>${escape(readFileSync(logFile, 'utf8'))}</pre>`
						: '<p>Too long to show here; open the file.</p>'
				}</details></section>`
			: '';
	const { ok, failed } = manifest.counts;
	const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>facetshot · ${escape(manifest.runId)}</title>
<style>
:root { --bg: #fafafa; --fg: #18181b; --muted: #71717a; --line: #e4e4e7; --bad: #be123c; --warn: #b45309 }
@media (prefers-color-scheme: dark) { :root { --bg: #111113; --fg: #f4f4f5; --muted: #a1a1aa; --line: #27272a; --bad: #fb7185; --warn: #fbbf24 } }
body { margin: 0; padding: 16px 24px 48px; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif }
header { display: flex; gap: 16px; align-items: baseline; flex-wrap: wrap; border-bottom: 1px solid var(--line); padding-bottom: 12px }
header p { margin: 0; color: var(--muted) }
nav { margin: 12px 0; display: flex; gap: 8px; flex-wrap: wrap } nav a { color: inherit }
section { margin-top: 32px } h2 { font-size: 16px; margin: 0 0 8px }
ul { margin: 0 0 12px; padding-left: 18px } li.error b { color: var(--bad) } li.warning b { color: var(--warn) } small { color: var(--muted) }
code { font-size: 12px; color: var(--muted) }
pre { font: 12px/1.5 ui-monospace, monospace; overflow-x: auto; padding: 12px; border: 1px solid var(--line) }
table { border-collapse: separate; border-spacing: 12px 8px; margin-left: -12px } th { text-align: left; font-weight: 600; vertical-align: top }
td { vertical-align: top } img { display: block; max-width: min(28vw, 420px); max-height: 420px; border: 1px solid var(--line) }
.fail { max-width: 300px; padding: 8px; border: 1px solid var(--bad); color: var(--bad) } .fail b { display: block }
i { display: inline-block; margin-top: 4px; font-style: normal; font-size: 12px; color: var(--muted) } i.changed { color: var(--bad) }
label { cursor: pointer }
@media (max-width: 700px) { img { max-width: 80vw } table, tr, td, th { display: block } }
</style>
<header><h1 style="font-size:18px;margin:0">facetshot</h1><p>${ok}/${manifest.cells.length} pictures${failed ? `, ${failed} failed` : ''} · ${manifest.screens.length} screens · ${(manifest.ms / 1000).toFixed(1)}s · ${escape(manifest.startedAt)}</p>
${hasDiff ? '<label><input type="checkbox" id="diff"> show changed pixels</label>' : ''}</header>
${manifest.errors.length ? `<ul>${manifest.errors.map((error) => `<li class="error">${escape(error)}</li>`).join('')}</ul>` : ''}
<nav>${manifest.screens.map(({ screen }) => `<a href="#${escape(screen)}">${escape(screen)}</a>`).join('')}</nav>
${sections}
${logs}
<script>
document.getElementById('diff')?.addEventListener('change', (event) => {
	for (const img of document.querySelectorAll('img[data-diff]')) {
		img.dataset.src ??= img.getAttribute('src');
		img.src = event.target.checked ? img.dataset.diff : img.dataset.src;
	}
});
</script></html>`;
	writeFileSync(join(manifest.out, 'report.html'), html);
	return 'report.html';
}
