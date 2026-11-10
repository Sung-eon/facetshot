import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LogBook, redact, writeLogs } from '../src/logs.ts';
import { parseStep } from '../src/flows.ts';

test('a log book keeps only its last entries, and reads on from a position', () => {
	const book = new LogBook(3);
	for (let i = 1; i <= 5; i += 1) book.add('console', 'info', `line ${i}`);
	expect(book.since(0).map((entry) => entry.text)).toEqual(['line 3', 'line 4', 'line 5']);
	expect(book.since(4).map((entry) => entry.text)).toEqual(['line 5']);
	expect(book.take()).toHaveLength(3);
	expect(book.take()).toHaveLength(0);
});

test('logs are written as JSON lines and as text, debug lines only in the JSON', () => {
	const folder = mkdtempSync(join(tmpdir(), 'fs-logs-'));
	const book = new LogBook();
	book.add('network', 'debug', 'GET /app.css 200');
	book.add('console', 'warn', 'Deprecated');
	book.add('page', 'error', 'Uncaught TypeError');
	const summary = writeLogs(folder, [
		{ label: 'home · phone · light', started: Date.now(), entries: book.since(0) }
	])!;
	expect(summary).toMatchObject({ count: 3, errors: 1, warnings: 1 });
	expect(readFileSync(join(folder, 'logs.ndjson'), 'utf8').trim().split('\n')).toHaveLength(3);
	const text = readFileSync(join(folder, 'logs.txt'), 'utf8');
	expect(text).toContain('== home · phone · light');
	expect(text).toContain('WARN');
	expect(text).not.toContain('app.css');
	expect(text).toContain('1 more at debug level');
});

test('steps for sessions: points, list numbers, drags, scrolling inside an element, bare steps', () => {
	expect(parseStep('rightclick:@120,40')).toEqual({ rightclick: '@120,40' });
	expect(parseStep('click:#3')).toEqual({ click: '#3' });
	expect(parseStep('drag:#2>#5')).toEqual({ drag: '#2', to: '#5' });
	expect(parseStep('scroll:.list=400')).toEqual({ scroll: '.list', by: 400 });
	expect(parseStep('back')).toEqual({ back: true });
	expect(parseStep('press:Shift+Meta+K')).toEqual({ press: 'Shift+Meta+K' });
});

test('secrets are taken out of log lines before they are kept', () => {
	expect(redact('WebSocket connected to ws://h/hub?access_token=ht_CfDJ8JqXX9iHS91&x=1')).toBe(
		'WebSocket connected to ws://h/hub?access_token=…&x=1'
	);
	expect(redact('GET /api?key=abcd1234&page=2 200')).toBe('GET /api?key=…&page=2 200');
	expect(redact('Authorization: Bearer abc.def-ghi_jkl')).toBe('Authorization: Bearer …');
	expect(redact('{"password":"hunter22"}')).toBe('{"password":"…"}');
	expect(redact('token eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSM')).toContain('eyJ…');
	expect(redact('GET /book/page/01a1c7e0 200 52ms')).toBe('GET /book/page/01a1c7e0 200 52ms');
	expect(redact('Showing the monkey page')).toBe('Showing the monkey page');
});
