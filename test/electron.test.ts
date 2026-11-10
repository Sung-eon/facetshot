import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
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
		expect([png.data[at], png.data[at + 1], png.data[at + 2]]).toEqual([0x16, 0x18, 0x1d]);
	}, 120_000);
});
