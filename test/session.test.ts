/**
 * Sessions end to end, through the MCP server and the daemon it starts (in a home of its own): open a page, work it
 * step by step, read what it logged, keep the steps as a flow and play it again.
 */
import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const site = join(import.meta.dir, 'fixtures', 'site');
const cli = join(import.meta.dir, '..', 'src', 'cli.ts');
const home = mkdtempSync(join(tmpdir(), 'facetshot-home-'));
const env = { ...(process.env as Record<string, string>), FACETSHOT_HOME: home };
const flow = join(site, 'flows-saved', 'dialog.yaml');
afterAll(() => {
	spawnSync(process.execPath, ['--bun', cli, 'daemon', 'stop'], { env, cwd: site });
	rmSync(join(site, '.facetshot'), { recursive: true, force: true });
	rmSync(join(site, 'flows-saved'), { recursive: true, force: true });
	rmSync(home, { recursive: true, force: true });
});

const text = (result: unknown) =>
	(result as { content: { type: string; text?: string }[] }).content
		.filter((part) => part.type === 'text')
		.map((part) => part.text)
		.join('\n');

test('a session is opened, worked step by step and saved as a flow', async () => {
	const client = new Client({ name: 'test', version: '1' });
	await client.connect(
		new StdioClientTransport({
			command: process.execPath,
			args: ['--bun', cli, 'mcp'],
			cwd: site,
			env
		})
	);
	try {
		const opened = await client.callTool({
			name: 'open',
			arguments: { target: '/second.html', device: 'desktop', variant: 'light' }
		});
		const openText = text(opened);
		const id = /^(s-[0-9a-f]+)/.exec(openText)![1];
		expect(openText).toContain('button "Open dialog"');
		expect((opened.content as { type: string }[]).some((part) => part.type === 'image')).toBe(true);

		const ref = /(e\d+) button "Open dialog"/.exec(openText)![1];
		const acted = await client.callTool({
			name: 'act',
			arguments: { session: id, steps: [`click:${ref}`] }
		});
		expect(text(acted)).toContain('button "Close"');
		// Structured too, for clients that read data.
		expect((acted.structuredContent as { session: string }).session).toBe(id);

		const textOnly = await client.callTool({
			name: 'act',
			arguments: { session: id, screenshot: false, tree: true }
		});
		expect((textOnly.content as { type: string }[]).every((part) => part.type === 'text')).toBe(
			true
		);
		expect(text(textOnly)).toContain('dialog');

		const failed = await client.callTool({
			name: 'act',
			arguments: { session: id, steps: ['click:text=Not there at all'] }
		});
		expect(failed.isError).toBe(true);
		expect(text(failed)).toContain("Step 1 didn't work");

		const closed = await client.callTool({
			name: 'close',
			arguments: { session: id, saveAs: 'flows-saved/dialog.yaml' }
		});
		expect(text(closed)).toContain('Closed');
		// The ref became a selector that finds the button again in a run of its own.
		const saved = readFileSync(flow, 'utf8');
		expect(saved).toContain('role=button[name="Open dialog"');
		expect(saved).not.toContain('Not there');
	} finally {
		await client.close();
	}
	const replay = spawnSync(
		process.execPath,
		['--bun', cli, flow, '--on', 'desktop', '--as', 'light', '--no-daemon'],
		{ env, cwd: site, encoding: 'utf8' }
	);
	expect(replay.stdout).toContain('1/1 screenshots');
}, 180_000);

test('a run writes what its pages logged, for people and for programs', () => {
	const runs = join(site, '.facetshot', 'runs');
	const latest = spawnSync(process.execPath, ['--bun', cli, 'logs', 'latest'], {
		env,
		cwd: site,
		encoding: 'utf8'
	});
	expect(latest.stdout).toContain('navigation');
	expect(existsSync(runs)).toBe(true);
});
