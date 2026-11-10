/**
 * End to end on the fixture site: the command line's run, and the MCP server through a real MCP client over stdio.
 * Needs Playwright's Chromium (npx playwright install chromium).
 */
import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadConfig } from '../src/config.ts';
import { run } from '../src/run.ts';

const site = join(import.meta.dir, 'fixtures', 'site');
const home = mkdtempSync(join(tmpdir(), 'facetshot-home-'));
process.env.FACETSHOT_HOME = home;
afterAll(() => {
	rmSync(join(site, '.facetshot'), { recursive: true, force: true });
	rmSync(home, { recursive: true, force: true });
});

test('a run takes every picture, draws a sheet per screen and finds the planted problems', async () => {
	const { config } = await loadConfig({ cwd: site });
	const manifest = await run(
		{
			targets: ['/', 'flow.yaml'],
			on: ['phone', 'desktop'],
			as: ['light', 'dark'],
			checks: ['all']
		},
		{ config }
	);
	expect(manifest.counts.failed).toBe(0);
	expect(manifest.cells).toHaveLength(8);
	expect(manifest.screens.map((screen) => screen.screen).sort()).toEqual(['flow.dialog', 'home']);
	for (const screen of manifest.screens)
		expect(existsSync(join(manifest.out, screen.sheet!))).toBe(true);
	const found = (screen: string, check: string) =>
		manifest.cells
			.filter((cell) => cell.screen === screen)
			.flatMap((cell) => cell.findings ?? [])
			.some((f) => f.check === check);
	expect(found('home', 'overflow')).toBe(true); // the 1200px bar on a phone
	expect(found('home', 'clipped')).toBe(true);
	expect(found('flow.dialog', 'images')).toBe(true);
	// The spinner is gone in every picture: readiness waited for it.
	expect(manifest.cells.every((cell) => !cell.readyTimedOut)).toBe(true);
}, 120_000);

test('the same run again shows nothing changed', async () => {
	const { config } = await loadConfig({ cwd: site });
	await run({ targets: ['/'], on: ['desktop'], as: ['light'] }, { config });
	const again = await run(
		{ targets: ['/'], on: ['desktop'], as: ['light'], diff: 'previous' },
		{ config }
	);
	expect(again.cells[0].diff?.ratio).toBe(0);
	expect(again.counts.changed).toBe(0);
}, 120_000);

test('the MCP server answers check, capture and inspect over stdio', async () => {
	const client = new Client({ name: 'test', version: '1' });
	await client.connect(
		new StdioClientTransport({
			command: process.execPath,
			args: ['--bun', join(import.meta.dir, '..', 'src', 'cli.ts'), 'mcp'],
			cwd: site,
			env: {
				...(process.env as Record<string, string>),
				FACETSHOT_HOME: home,
				FACETSHOT_NO_DAEMON: '1'
			}
		})
	);
	try {
		const { tools } = await client.listTools();
		expect(tools.map((tool) => tool.name).sort()).toEqual([
			'capture',
			'check',
			'compare',
			'inspect',
			'list'
		]);

		const checked = await client.callTool({
			name: 'check',
			arguments: { targets: ['/'], devices: ['phone'], variants: ['light'] }
		});
		const checkText = (checked.content as { type: string; text?: string }[])[0].text!;
		expect(checkText).toContain('overflow');

		const captured = await client.callTool({
			name: 'capture',
			arguments: { targets: ['/'], devices: ['phone', 'desktop'], variants: ['light'] }
		});
		const parts = captured.content as { type: string; mimeType?: string; data?: string }[];
		expect(parts.filter((part) => part.type === 'image')).toHaveLength(1);
		// A tool result an agent can afford: the sheet is a JPEG well under a megabyte.
		expect(
			Buffer.from(parts.find((part) => part.type === 'image')!.data!, 'base64').length
		).toBeLessThan(1_000_000);

		const inspected = await client.callTool({
			name: 'inspect',
			arguments: {
				screen: 'home',
				device: 'phone',
				variant: 'light',
				region: { x: 0, y: 0, width: 390, height: 100 }
			}
		});
		expect((inspected.content as { type: string }[]).map((part) => part.type)).toEqual([
			'text',
			'image'
		]);
	} finally {
		await client.close();
	}
}, 120_000);
