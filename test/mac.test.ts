/**
 * Native Mac app windows end to end, against the small SwiftUI app in fixtures/mac-app, built here with swiftc (no
 * Xcode project). Screenshots and logs need Screen Recording for whatever runs the tests; steps and sessions need
 * Accessibility too. Each part is skipped when its permission isn't there.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { withAllDrivers } from './drivers.helper.ts';

const scratch = mkdtempSync(join(tmpdir(), 'facetshot-mac-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const mac = process.platform === 'darwin';
/** What the helper says about a permission, or '' when it can't be asked. */
async function permission(command: 'check' | 'trusted'): Promise<string> {
	if (!mac) return '';
	const { helper } = await import('../src/drivers/macos.ts');
	return execFileSync(await helper(), [command], { encoding: 'utf8' }).trim();
}
const recording = (await permission('check')) === 'granted';
const accessibility = (await permission('trusted')) === 'granted';

/** Builds Notes.app from the fixture's one Swift file. */
function buildApp(): string {
	const app = join(scratch, 'Notes.app');
	mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
	execFileSync('xcrun', [
		'swiftc',
		'-parse-as-library',
		join(import.meta.dir, 'fixtures', 'mac-app', 'Notes.swift'),
		'-o',
		join(app, 'Contents', 'MacOS', 'Notes')
	]);
	writeFileSync(
		join(app, 'Contents', 'Info.plist'),
		`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Notes</string>
<key>CFBundleIdentifier</key><string>dev.facetshot.test.notes</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`
	);
	return app;
}

describe.skipIf(!recording)('Mac app windows', () => {
	const app = recording ? buildApp() : '';
	const config = {
		root: scratch,
		out: join(scratch, 'out'),
		desktop: { kind: 'macos' as const, app }
	};

	test('a screen is the window at the device size, with what the app printed', async () => {
		await withAllDrivers();
		const { run } = await import('../src/run.ts');
		const manifest = await run(
			{ targets: ['app:/'], on: ['window-small'], as: ['light'] },
			{ config: { ...config, out: join(scratch, 'plain') } }
		);
		expect(manifest.cells.map((cell) => cell.status)).toEqual(['ok']);
		const logs = readFileSync(join(manifest.out, manifest.logs!.text), 'utf8');
		expect(logs).toContain('app           Started on /');
		// The system's frameworks talk in the app's process too; none of that is the app's.
		expect(logs).not.toContain('CFPrefsD');
	}, 120_000);

	test.skipIf(!accessibility)(
		'a flow types, presses, opens a context menu and uses the menu bar',
		async () => {
			await withAllDrivers();
			writeFileSync(
				join(scratch, 'save.yaml'),
				[
					'start: /',
					'steps:',
					'  - fill: role=textbox[name="Name"]',
					'    with: Grace',
					'  - click: role=button[name="Save"]',
					'  - wait: text=Saved.',
					'  - rightclick: text=Right-click here',
					'  - wait: role=menuitem[name="Copy link"]',
					'  - shot: menu',
					'  - press: Escape',
					'  - menu: Note>Export…',
					'  - shot: exported'
				].join('\n')
			);
			const { run } = await import('../src/run.ts');
			const manifest = await run(
				{ targets: [join(scratch, 'save.yaml')], on: ['window-small'], as: ['light'] },
				{ config }
			);
			expect(manifest.cells.map((cell) => [cell.screen, cell.status, cell.error]).sort()).toEqual([
				['save.exported', 'ok', undefined],
				['save.menu', 'ok', undefined]
			]);
			// FACETSHOT_KEEP_SHOT=<file> keeps the screenshot with the menu open, to look at.
			if (process.env.FACETSHOT_KEEP_SHOT) {
				const menu = manifest.cells.find((cell) => cell.screen === 'save.menu')!;
				writeFileSync(
					process.env.FACETSHOT_KEEP_SHOT,
					readFileSync(join(manifest.out, menu.image!))
				);
			}
			const logs = readFileSync(join(manifest.out, manifest.logs!.text), 'utf8');
			expect(logs).toContain('Saved Grace');
			// From os.Logger, through the system log.
			expect(logs).toContain('Saved a note for Grace');
			expect(logs).toContain('Exported 2 notes');
		},
		180_000
	);

	test.skipIf(!accessibility)(
		'a session lists the window by ref, presses one and saves the steps as a flow',
		async () => {
			const home = mkdtempSync(join(tmpdir(), 'facetshot-home-'));
			const cli = join(import.meta.dir, '..', 'src', 'cli.ts');
			const env = { ...(process.env as Record<string, string>), FACETSHOT_HOME: home };
			writeFileSync(
				join(scratch, 'facetshot.config.ts'),
				`export default { desktop: { kind: 'macos', app: ${JSON.stringify(app)} } };`
			);
			const client = new Client({ name: 'test', version: '1' });
			await client.connect(
				new StdioClientTransport({
					command: process.execPath,
					args: ['--bun', cli, 'mcp'],
					cwd: scratch,
					env
				})
			);
			try {
				const said = (result: unknown) =>
					(result as { content: { type: string; text?: string }[] }).content
						.map((part) => part.text ?? '')
						.join('\n');
				const opened = said(
					await client.callTool({
						name: 'open',
						arguments: { target: 'app:/', device: 'window-small' }
					})
				);
				expect(opened).toContain('points');
				const id = /^(s-[0-9a-f]+)/.exec(opened)![1];
				const ref = /(e\d+) button "Save"/.exec(opened)![1];
				const pressed = said(
					await client.callTool({
						name: 'act',
						arguments: { session: id, steps: [`click:${ref}`], tree: true }
					})
				);
				expect(pressed).toContain('Saved Ada');
				// From os.Logger, through the system log.
				expect(pressed).toContain('Saved a note for Ada');
				expect(pressed).toContain('text "Saved."');
				expect(pressed).toContain('textbox "Name"');
				const closed = said(
					await client.callTool({ name: 'close', arguments: { session: id, saveAs: 'saved.yaml' } })
				);
				expect(closed).toContain('saved.yaml');
				expect(readFileSync(join(scratch, 'saved.yaml'), 'utf8')).toContain(
					'click: role=button[name="Save"]'
				);
				expect(spawnSync('pgrep', ['-f', join(app, 'Contents', 'MacOS')]).status).toBe(1);
			} finally {
				await client.close();
				spawnSync(process.execPath, ['--bun', cli, 'daemon', 'stop'], { env, cwd: scratch });
				rmSync(home, { recursive: true, force: true });
			}
		},
		180_000
	);
});
