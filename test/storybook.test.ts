import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	globalsFor,
	matchStories,
	parseIndex,
	skippedByTags,
	storyScreen,
	storyUrl,
	type StoryEntry
} from '../src/drivers/storybook.ts';
import { serveStatic } from '../src/engine/static.ts';
import type { Running } from '../src/engine/procs.ts';
import { withAllDrivers } from './drivers.helper.ts';

const entry = (
	id: string,
	title: string,
	name: string,
	tags: string[] = ['dev', 'test'],
	type: 'story' | 'docs' = 'story'
): StoryEntry => ({ id, title, name, tags, type });

const ENTRIES: StoryEntry[] = [
	entry('button--docs', 'Button', 'Docs', ['dev', 'autodocs'], 'docs'),
	entry('button--primary', 'Button', 'Primary'),
	entry('button--long-label', 'Button', 'Long Label'),
	entry('button--playground', 'Button', 'Playground', ['dev', 'test', 'facetshot-skip']),
	entry('button--internal', 'Button', 'Internal', ['dev']),
	entry('pricing-plancard--default', 'Pricing/PlanCard', 'Default'),
	entry('pricing-plancard--highlighted', 'Pricing/PlanCard', 'Highlighted')
];
const ids = (pattern: string) => matchStories(pattern, ENTRIES).map((story) => story.id);

describe('Storybook index', () => {
	test('reads v5 entries and v3 stories, and says what to do with anything else', () => {
		expect(
			parseIndex({
				v: 5,
				entries: { a: { id: 'a', title: 'A', name: 'One', type: 'story', tags: ['dev'] } }
			})
		).toEqual([{ id: 'a', title: 'A', name: 'One', type: 'story', tags: ['dev'] }]);
		expect(
			parseIndex({ v: 3, stories: { b: { id: 'b', title: 'B', name: 'Two' } } })[0]
		).toMatchObject({ id: 'b', type: 'story', tags: [] });
		expect(() => parseIndex({ nope: true })).toThrow(/no `entries`/);
	});

	test('skip tags: facetshot-skip, !test, and a resolved tag list without test', () => {
		expect(skippedByTags(['facetshot-skip'])).toBe(true);
		expect(skippedByTags(['!test'])).toBe(true);
		expect(skippedByTags(['dev'])).toBe(true);
		expect(skippedByTags(['dev', 'test'])).toBe(false);
		// Storybook 7 has no default tags at all: nothing to read, so nothing is skipped.
		expect(skippedByTags([])).toBe(false);
	});
});

describe('matching stories', () => {
	test('an exact id or title/name is taken even when its tags would skip it', () => {
		expect(ids('button--playground')).toEqual(['button--playground']);
		expect(ids('Button/Long Label')).toEqual(['button--long-label']);
		expect(ids('BUTTON--PRIMARY')).toEqual(['button--primary']);
	});

	test('a title names every story of that component or folder, without skipped ones or docs', () => {
		expect(ids('Button')).toEqual(['button--primary', 'button--long-label']);
		expect(ids('Pricing')).toEqual(['pricing-plancard--default', 'pricing-plancard--highlighted']);
	});

	test('globs over title/name, titles and ids', () => {
		expect(ids('Button/*')).toEqual(['button--primary', 'button--long-label']);
		expect(ids('Pricing/*')).toEqual([
			'pricing-plancard--default',
			'pricing-plancard--highlighted'
		]);
		expect(ids('Pricing/**')).toEqual([
			'pricing-plancard--default',
			'pricing-plancard--highlighted'
		]);
		expect(ids('*--highlighted')).toEqual(['pricing-plancard--highlighted']);
		expect(ids('*')).toEqual([
			'button--primary',
			'button--long-label',
			'pricing-plancard--default',
			'pricing-plancard--highlighted'
		]);
		expect(ids('Nothing/*')).toEqual([]);
	});

	test('screens, addresses and globals', () => {
		expect(storyScreen({ title: 'Pricing/PlanCard', name: 'Long Label' })).toBe(
			'Pricing.PlanCard.Long-Label'
		);
		expect(storyUrl('http://127.0.0.1:6006', 'button--primary')).toBe(
			'http://127.0.0.1:6006/iframe.html?id=button--primary&viewMode=story'
		);
		expect(storyUrl('http://h/sb/', 'x--y', 'theme:dark;locale:ko-KR')).toBe(
			'http://h/sb/iframe.html?id=x--y&viewMode=story&globals=theme:dark;locale:ko-KR'
		);
		const globals = {
			dark: 'theme:dark',
			light: 'theme:light',
			rtl: 'direction:rtl',
			locale: 'locale:{locale}'
		};
		expect(globalsFor({ name: 'dark', appearance: 'dark' }, globals)).toBe('theme:dark');
		expect(
			globalsFor({ name: 'dark+rtl', appearance: 'dark', direction: 'rtl', locale: 'ar' }, globals)
		).toBe('theme:dark;direction:rtl;locale:ar');
		expect(globalsFor({ name: 'large', text: 'large' }, undefined)).toBe('');
	});
});

/* End to end against the vite-react example's Storybook build, if it has been built (bun run build-storybook). */
const example = join(import.meta.dir, '..', 'examples', 'vite-react');
const built = existsSync(join(example, 'storybook-static', 'index.json'));
const out = mkdtempSync(join(tmpdir(), 'facetshot-storybook-'));
let server: Running | undefined;
afterAll(async () => {
	await server?.stop();
	rmSync(out, { recursive: true, force: true });
});

describe.skipIf(!built)('Storybook end to end', () => {
	test('a pattern becomes one picture per story, skipped stories left out, readiness from Storybook', async () => {
		await withAllDrivers();
		const { run } = await import('../src/run.ts');
		server = await serveStatic('storybook', join(example, 'storybook-static'));
		const manifest = await run(
			{ targets: ['story:Button/*', 'story:Nothing/*'], on: ['phone'], as: ['dark'] },
			{ config: { root: example, out, storybook: { url: server.url } } }
		);
		const ok = manifest.cells.filter((cell) => cell.status === 'ok');
		expect(ok.map((cell) => cell.target).sort()).toEqual([
			'button--long-label',
			'button--primary',
			'button--secondary'
		]);
		expect(ok.every((cell) => cell.image && cell.width === 390 * 3)).toBe(true);
		expect(ok.find((cell) => cell.target === 'button--primary')?.screen).toBe('Button.Primary');
		expect(ok.every((cell) => !cell.readyTimedOut)).toBe(true);
		const missing = manifest.cells.find((cell) => cell.status === 'failed');
		expect(missing?.error).toContain('No story matches "Nothing/*"');
	}, 120_000);
});
