import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { bundleExecutable } from '../src/drivers/apple.ts';
import { launchSwitches, resolveLaunch } from '../src/drivers/electron.ts';
import { withAllDrivers } from './drivers.helper.ts';

const scratch = mkdtempSync(join(tmpdir(), 'facetshot-electron-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('what to launch', () => {
	test('a packaged .app runs its own executable, named in Info.plist', () => {
		const app = join(scratch, 'Tally.app');
		mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
		writeFileSync(
			join(app, 'Contents', 'Info.plist'),
			'<plist><dict><key>CFBundleExecutable</key>\n<string>tally-bin</string></dict></plist>'
		);
		expect(bundleExecutable(app)).toBe(join(app, 'Contents', 'MacOS', 'tally-bin'));
		expect(resolveLaunch({ kind: 'electron', main: 'Tally.app', args: ['--x'] }, scratch)).toEqual({
			executablePath: join(app, 'Contents', 'MacOS', 'tally-bin'),
			args: ['--x']
		});
	});

	test('a script runs in the given Electron, after the switches', () => {
		writeFileSync(join(scratch, 'main.js'), '');
		writeFileSync(join(scratch, 'electron-bin'), '');
		expect(
			resolveLaunch({ kind: 'electron', main: 'main.js', executable: 'electron-bin' }, scratch)
		).toEqual({
			executablePath: join(scratch, 'electron-bin'),
			args: [join(scratch, 'main.js')]
		});
		expect(launchSwitches({ name: 'ko', locale: 'ko-KR' }, 2)).toEqual([
			'--force-device-scale-factor=2',
			'--lang=ko-KR'
		]);
	});

	test('a missing main or Electron says what to do', () => {
		expect(() => resolveLaunch({ kind: 'electron', main: 'nope.js' }, scratch)).toThrow(
			/doesn't exist/
		);
		expect(() => resolveLaunch({ kind: 'electron', main: 'main.js' }, scratch)).toThrow(
			/There is no Electron/
		);
	});
});

/* End to end against examples/electron, when its Electron has been downloaded (bun install there, then run it once). */
const example = join(import.meta.dir, '..', 'examples', 'electron');
const binary = join(example, 'node_modules', 'electron', 'path.txt');
const installed =
	existsSync(binary) &&
	existsSync(join(example, 'node_modules', 'electron', 'dist', readFileSync(binary, 'utf8')));

describe.skipIf(!installed || process.platform !== 'darwin')('Electron end to end', () => {
	test('an app screen and a flow, in dark, at the window size, with checks', async () => {
		await withAllDrivers();
		const { run } = await import('../src/run.ts');
		const manifest = await run(
			{
				targets: ['app:/reports', join(example, 'open-reports.yaml')],
				on: ['window-small'],
				as: ['dark'],
				checks: ['console', 'overflow']
			},
			{
				config: {
					root: example,
					out: join(scratch, 'out'),
					desktop: { kind: 'electron', main: '.', navigate: 'hash' }
				}
			}
		);
		expect(manifest.errors).toEqual([]);
		expect(manifest.cells.map((cell) => [cell.screen, cell.status])).toEqual([
			['open-reports.reports-from-today', 'ok'],
			['reports', 'ok']
		]);
		const cell = manifest.cells.find((each) => each.screen === 'reports')!;
		expect([cell.width, cell.height]).toEqual([960 * 2, 640 * 2]);
		expect(cell.findings).toEqual([]);
		// The page's background in its dark scheme (#16181d), well inside the main area.
		const png = PNG.sync.read(readFileSync(join(manifest.out, cell.image!)));
		const at = (png.width * 1000 + 1500) * 4;
		// Within 2 per channel: the window's colour conversion may round differently from one machine to the next.
		const want = [0x16, 0x18, 0x1d];
		for (const [index, value] of want.entries())
			expect(Math.abs(png.data[at + index] - value)).toBeLessThanOrEqual(2);
	}, 120_000);

	test("a flow chooses from the app's menu, and the main process's output is in the logs", async () => {
		await withAllDrivers();
		const { run } = await import('../src/run.ts');
		const manifest = await run(
			{ targets: [join(example, 'menu-export.yaml')], on: ['window-small'], as: ['light'] },
			{
				config: {
					root: example,
					out: join(scratch, 'menu'),
					desktop: { kind: 'electron', main: '.', navigate: 'hash' }
				}
			}
		);
		expect(manifest.cells.map((cell) => cell.status)).toEqual(['ok']);
		const logs = readFileSync(join(manifest.out, manifest.logs!.text), 'utf8');
		// console.log in main, reported once though it reaches both the console and standard output…
		expect(logs.match(/Showing #\/reports/g)).toHaveLength(1);
		// …and a line written straight to standard output, as a native module would.
		expect(logs).toContain('Exported 3 rows to report.csv');
	}, 120_000);

	test('a session opens the app, clicks by ref, chooses from the menu and closes the app', async () => {
		const home = mkdtempSync(join(tmpdir(), 'facetshot-home-'));
		const cli = join(import.meta.dir, '..', 'src', 'cli.ts');
		const env = { ...(process.env as Record<string, string>), FACETSHOT_HOME: home };
		const client = new Client({ name: 'test', version: '1' });
		await client.connect(
			new StdioClientTransport({
				command: process.execPath,
				args: ['--bun', cli, 'mcp'],
				cwd: example,
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
			const id = /^(s-[0-9a-f]+)/.exec(opened)![1];
			const ref = /(\S+) link "Reports"/.exec(opened)![1];
			const clicked = said(
				await client.callTool({ name: 'act', arguments: { session: id, steps: [`click:${ref}`] } })
			);
			expect(clicked).toContain('main Showing #/reports');
			const chosen = said(
				await client.callTool({
					name: 'act',
					arguments: { session: id, steps: ['menu:File>Export Report…'], screenshot: false }
				})
			);
			expect(chosen).toContain('Exported 3 rows to report.csv');
			await client.callTool({ name: 'close', arguments: { session: id } });
			expect(spawnSync('pgrep', ['-f', join(example, 'node_modules', 'electron')]).status).toBe(1);
		} finally {
			await client.close();
			spawnSync(process.execPath, ['--bun', cli, 'daemon', 'stop'], { env, cwd: example });
			rmSync(home, { recursive: true, force: true });
		}
	}, 180_000);
});
