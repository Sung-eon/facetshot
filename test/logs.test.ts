import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LogBook, redact, writeLogs } from '../src/logs.ts';
import { parseStep } from '../src/flows.ts';
import { onScreen, refOf, selectorOf } from '../src/session.ts';

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
	expect(parseStep('click:e3')).toEqual({ click: 'e3' });
	expect(parseStep('drag:e2>e5')).toEqual({ drag: 'e2', to: 'e5' });
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

test("what's on screen is read from Playwright's snapshot, frames moved into place", () => {
	const snapshot = [
		'- generic [ref=e1] [box=0,0,800,600]:',
		'  - link "Home" [ref=e3] [cursor=pointer] [box=8,8,39,18]:',
		'  - textbox "Name" [ref=e7] [box=50,107,153,21]: Ada',
		'  - checkbox "Weekly" [checked] [ref=e9] [box=207,109,13,13]',
		'  - option "Small" [selected] [box=0,0,0,0]',
		'  - button "Far below" [ref=e20] [box=10,5000,40,20]',
		'  - iframe [ref=e15] [box=100,200,304,154]:',
		'    - button "Inside" [ref=f1e2] [box=8,8,52,21]'
	].join('\n');
	const found = onScreen(snapshot, { width: 800, height: 600 });
	expect(found.map((each) => each.ref)).toEqual(['e3', 'e7', 'e9', 'f1e2']);
	expect(found[1].value).toBe('Ada');
	expect(found[2].states).toEqual(['checked']);
	expect([found[3].x, found[3].y]).toEqual([108, 208]);
	expect(refOf('e12')).toBe('e12');
	expect(refOf('ref=f1e3')).toBe('f1e3');
	expect(refOf('text=e12')).toBeUndefined();
});

test("Playwright's best locator for an element is written as a selector a flow can use", () => {
	expect(selectorOf("getByRole('button', { name: 'Save' })")).toBe('role=button[name="Save"i]');
	expect(selectorOf("getByRole('link', { name: 'It\\'s me', exact: true })")).toBe(
		'role=link[name="It\'s me"s]'
	);
	expect(selectorOf("getByTestId('menu')")).toBe('internal:testid=[data-testid="menu"s]');
	expect(selectorOf("getByLabel('Email')")).toBe('internal:label="Email"i');
	expect(selectorOf("locator('#submit')")).toBe('#submit');
	expect(selectorOf("getByRole('row').nth(2)")).toBeUndefined();
});

test('web devices in other browser engines: --browser, and device@engine', async () => {
	const { plan } = await import('../src/plan.ts');
	const both = plan(
		{ targets: ['/'], on: ['phone', 'desktop'], as: ['light'], browsers: ['chromium', 'webkit'] },
		{}
	);
	expect(both.devices.map((d) => d.name)).toEqual([
		'phone',
		'phone@webkit',
		'desktop',
		'desktop@webkit'
	]);
	const one = plan({ targets: ['/'], on: ['phone@firefox'], as: ['light'] }, {});
	expect(one.devices[0]).toMatchObject({ name: 'phone@firefox', browser: 'firefox', width: 390 });
	const group = plan({ targets: ['/'], on: ['review@webkit'], as: ['light'] }, {});
	expect(group.devices.every((d) => d.browser === 'webkit')).toBe(true);
	expect(() => plan({ targets: ['/'], on: ['phone@safari'] }, {})).toThrow("isn't a browser");
	expect(() => plan({ targets: ['/'], on: ['iphone@webkit'] }, {})).toThrow('web device');
});
