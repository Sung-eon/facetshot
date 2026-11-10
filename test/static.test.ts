import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveStatic, serveStatic } from '../src/engine/static.ts';

const folder = mkdtempSync(join(tmpdir(), 'facetshot-static-'));
mkdirSync(join(folder, 'docs'));
writeFileSync(join(folder, 'index.html'), '<h1>home</h1>');
writeFileSync(join(folder, 'docs', 'index.html'), '<h1>docs</h1>');
writeFileSync(join(folder, 'app.js'), 'console.log(1)');
afterAll(() => rmSync(folder, { recursive: true, force: true }));

test('files, folder indexes, a fallback, and nothing outside the folder', () => {
	expect(resolveStatic(folder, '/app.js')).toBe(join(folder, 'app.js'));
	expect(resolveStatic(folder, '/docs/')).toBe(join(folder, 'docs', 'index.html'));
	expect(resolveStatic(folder, '/missing')).toBeUndefined();
	expect(resolveStatic(folder, '/missing', { fallback: 'index.html' })).toBe(
		join(folder, 'index.html')
	);
	expect(resolveStatic(folder, '/../../etc/passwd')).toBeUndefined();
	expect(resolveStatic(folder, '/%2e%2e/%2e%2e/etc/passwd')).toBeUndefined();
});

test('serves with content types and stops', async () => {
	const server = await serveStatic('test', folder);
	const script = await fetch(`${server.url}/app.js`);
	expect(script.headers.get('content-type')).toContain('text/javascript');
	expect(await (await fetch(`${server.url}/`)).text()).toBe('<h1>home</h1>');
	expect((await fetch(`${server.url}/nope`)).status).toBe(404);
	await server.stop();
	expect(
		await fetch(`${server.url}/`).then(
			() => 'answered',
			() => 'closed'
		)
	).toBe('closed');
});
