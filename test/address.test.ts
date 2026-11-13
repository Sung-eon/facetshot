/** Where a target, a flow's `goto` or a session's start leads, against `web.baseURL`. */
import { expect, test } from 'bun:test';
import { addressOf, resolveAddress } from '../src/drivers/web.ts';
import { readyRuleFor } from '../src/drivers/page.ts';

test('paths go under the base URL’s own path, with or without its trailing slash', () => {
	for (const base of ['http://localhost:4391/docs', 'http://localhost:4391/docs/']) {
		expect(resolveAddress('/', base)).toBe('http://localhost:4391/docs/');
		expect(resolveAddress('/settings', base)).toBe('http://localhost:4391/docs/settings');
		expect(resolveAddress('settings', base)).toBe('http://localhost:4391/docs/settings');
		expect(resolveAddress('/a/b?tab=2#top', base)).toBe('http://localhost:4391/docs/a/b?tab=2#top');
		expect(resolveAddress('/?q=1', base)).toBe('http://localhost:4391/docs/?q=1');
		expect(resolveAddress('/#intro', base)).toBe('http://localhost:4391/docs/#intro');
		expect(resolveAddress('/time:12', base)).toBe('http://localhost:4391/docs/time:12');
	}
});

test('a base URL without a path, or with a query of its own', () => {
	expect(resolveAddress('/', 'http://localhost:3000')).toBe('http://localhost:3000/');
	expect(resolveAddress('/settings', 'http://localhost:3000/')).toBe(
		'http://localhost:3000/settings'
	);
	expect(resolveAddress('/settings', 'http://localhost:3000/app?lang=en')).toBe(
		'http://localhost:3000/app/settings'
	);
});

test('full URLs, and addresses with no base, are left as they are', () => {
	const base = 'http://localhost:4391/docs';
	expect(resolveAddress('https://example.com/x', base)).toBe('https://example.com/x');
	expect(resolveAddress('file:///tmp/a.html', base)).toBe('file:///tmp/a.html');
	expect(resolveAddress('//cdn.example.com/x', base)).toBe('http://cdn.example.com/x');
	expect(resolveAddress('/settings', undefined)).toBe('/settings');
});

test('an opened URL gives back the path a target would name, under the base’s own path', () => {
	for (const base of ['http://localhost:4391/docs', 'http://localhost:4391/docs/']) {
		expect(addressOf('http://localhost:4391/docs/settings?tab=2', base)).toBe('/settings');
		expect(addressOf('http://localhost:4391/docs/', base)).toBe('/');
		expect(addressOf('http://localhost:4391/docs', base)).toBe('/');
		expect(addressOf('http://localhost:4391/docsets/x', base)).toBe('/docsets/x');
		expect(addressOf('https://example.com/docs/settings', base)).toBe('/docs/settings');
	}
	expect(addressOf('http://localhost:3000/settings', 'http://localhost:3000')).toBe('/settings');
	expect(addressOf('http://localhost:3000/settings', undefined)).toBe('/settings');
});

test('a session under a base with a path matches readiness rules written for the path alone', () => {
	const ready = { routes: { '/settings': { idle: 0 } } };
	const address = addressOf(
		resolveAddress('/settings', 'http://localhost:4391/docs'),
		'http://localhost:4391/docs'
	);
	expect(readyRuleFor(address, ready).idle).toBe(0);
});
