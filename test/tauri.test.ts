import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deepLink, tauriEngine, tauriMockScript, variantEnv } from '../src/drivers/tauri.ts';
import { withAllDrivers } from './drivers.helper.ts';

describe('Tauri', () => {
	test('the engine follows the config: webkit when there is a frontend, otherwise the window', () => {
		expect(tauriEngine({ kind: 'tauri', frontend: { url: 'http://localhost:1420' } })).toBe(
			'webkit'
		);
		expect(tauriEngine({ kind: 'tauri', app: 'X.app' })).toBe('window');
		expect(tauriEngine({ kind: 'tauri', frontend: { url: 'x' }, engine: 'window' })).toBe('window');
	});

	test('deep links and the variant environment', () => {
		expect(deepLink('pebble', '/about')).toBe('pebble://about');
		expect(deepLink('pebble://', '/notes/1')).toBe('pebble://notes/1');
		expect(deepLink('pebble', 'other://x')).toBe('other://x');
		expect(
			variantEnv(
				{ name: 'w', platform: 'window', width: 960, height: 640, scale: 2 },
				{ name: 'dark+ko', appearance: 'dark', locale: 'ko-KR' }
			)
		).toMatchObject({
			FACETSHOT_WIDTH: '960',
			FACETSHOT_HEIGHT: '640',
			FACETSHOT_APPEARANCE: 'dark',
			FACETSHOT_LOCALE: 'ko-KR',
			LANG: 'ko_KR.UTF-8'
		});
	});

	test('the invoke stand-in answers listed commands and names the rest', async () => {
		const window = {} as {
			__TAURI_INTERNALS__: { invoke(command: string, args: object): Promise<unknown> };
			isTauri?: boolean;
		};
		new Function('window', tauriMockScript({ greet: 'hi' }))(window);
		expect(await window.__TAURI_INTERNALS__.invoke('greet', {})).toBe('hi');
		expect(typeof (await window.__TAURI_INTERNALS__.invoke('plugin:event|listen', {}))).toBe(
			'number'
		);
		await expect(window.__TAURI_INTERNALS__.invoke('save', {})).rejects.toThrow(/desktop\.invoke/);
		expect(window.isTauri).toBe(true);
	});
});

/* End to end against examples/tauri's frontend in WebKit, when its dependencies are installed. */
const example = join(import.meta.dir, '..', 'examples', 'tauri');
const out = mkdtempSync(join(tmpdir(), 'facetshot-tauri-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe.skipIf(!existsSync(join(example, 'node_modules', 'vite')))(
	'Tauri frontend end to end',
	() => {
		test('app screens in WebKit, with invoke answered from the config', async () => {
			await withAllDrivers();
			const { run } = await import('../src/run.ts');
			const { default: config } = await import(join(example, 'facetshot.config.ts'));
			const manifest = await run(
				{
					targets: ['app:/', 'app:/about'],
					on: ['window-small'],
					as: ['light'],
					checks: ['console']
				},
				{ config: { ...config, root: example, out } }
			);
			expect(manifest.errors).toEqual([]);
			expect(manifest.cells.every((cell) => cell.status === 'ok' && cell.width === 1920)).toBe(
				true
			);
			expect(manifest.cells.flatMap((cell) => cell.findings ?? [])).toEqual([]);
		}, 180_000);
	}
);
