import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTarget, plan, resolveVariants, slugify, targetsOf } from '../src/plan.ts';
import { notApplied } from '../src/drivers/driver.ts';
import { UsageError } from '../src/errors.ts';

describe('targets', () => {
	test('the shape says the kind', () => {
		expect(parseTarget('/talk').kind).toBe('web');
		expect(parseTarget('https://example.com/a').kind).toBe('web');
		expect(parseTarget('app:/book').kind).toBe('app');
		expect(parseTarget('story:button--primary').kind).toBe('story');
		expect(parseTarget('preview:Book/Page').kind).toBe('preview');
		expect(parseTarget('flows/open-menu.yaml').kind).toBe('flow');
	});

	test('an alias stands for its target, and the name stays readable', () => {
		const target = parseTarget('page', { aliases: { page: '/book/page/{page}' } });
		expect(target).toMatchObject({ kind: 'web', value: '/book/page/{page}' });
		expect(target.slug).toBe('book-page-page');
		expect(parseTarget('flows/open-menu.flow.yaml').slug).toBe('open-menu');
		expect(slugify('/')).toBe('home');
	});

	test('something unrecognisable says what to write instead', () => {
		expect(() => parseTarget('talk')).toThrow(UsageError);
	});
});

describe('the plan', () => {
	test('is targets × devices × variants, only where the device can show the target', () => {
		const result = plan(
			{ targets: ['/a', 'app:/b'], on: ['phone', 'iphone'], as: ['light', 'dark'] },
			{}
		);
		expect(result.cells).toHaveLength(4);
		expect(
			result.cells
				.filter((cell) => cell.target.kind === 'web')
				.every((cell) => cell.device.platform === 'web')
		).toBe(true);
	});

	test('a target no device can show is reported, not dropped silently', () => {
		const result = plan({ targets: ['app:/b'], on: ['phone'] }, {});
		expect(result.cells).toHaveLength(0);
		expect(result.unmatched[0]).toContain('app:/b');
	});

	test('app targets alone fall back to Apple devices when the profile is all web', () => {
		const result = plan({ targets: ['app:/b'] }, {});
		expect(result.devices.every((device) => device.platform === 'ios')).toBe(true);
	});

	test('groups expand, and unknown names list what exists', () => {
		expect(plan({ targets: ['/'], on: ['review'], as: ['light'] }, {}).devices).toHaveLength(4);
		expect(() => plan({ targets: ['/'], on: ['watch'] }, {})).toThrow(/no device called "watch"/);
	});

	test('variants combine with +', () => {
		const [variant] = resolveVariants(['dark+large'], {});
		expect(variant).toEqual({ name: 'dark+large', appearance: 'dark', text: 'large' });
	});

	test('a config adds devices that extend built-in ones', () => {
		const result = plan(
			{ targets: ['/'], on: ['wide'], as: ['light'] },
			{ devices: { wide: { extends: 'desktop', width: 1920 } } }
		);
		expect(result.devices[0]).toMatchObject({
			name: 'wide',
			width: 1920,
			height: 900,
			platform: 'web'
		});
	});
});

describe('profiles as batches', () => {
	const root = mkdtempSync(join(tmpdir(), 'facetshot-plan-'));
	mkdirSync(join(root, 'flows'));
	writeFileSync(join(root, 'flows', 'a.yaml'), 'start: /\nsteps:\n  - shot: one\n');
	writeFileSync(join(root, 'flows', 'b.yaml'), 'start: /settings\nsteps:\n  - shot: two\n');
	const config = {
		root,
		profiles: {
			release: { targets: ['/', 'flows/*.yaml'], on: ['phone'], as: ['light'] }
		}
	};

	test('with no targets, the profile names them, and a flow pattern becomes its files', () => {
		expect(targetsOf({ targets: [], profile: 'release' }, config)).toEqual([
			'/',
			'flows/a.yaml',
			'flows/b.yaml'
		]);
		expect(plan({ targets: [], profile: 'release' }, config).cells).toHaveLength(3);
	});

	test('targets given win over the profile', () => {
		expect(targetsOf({ targets: ['/x'], profile: 'release' }, config)).toEqual(['/x']);
	});

	test('nothing to shoot, or a pattern that matches nothing, says so', () => {
		expect(() => targetsOf({ targets: [] }, config)).toThrow(UsageError);
		expect(() => targetsOf({ targets: ['flows/none-*.yaml'] }, config)).toThrow(UsageError);
	});

	test('the default profile gives web and app targets each their own devices', () => {
		const mixed = plan(
			{ targets: ['/', 'app:/inbox'] },
			{ apple: { bundleId: 'demo.app', scheme: 'demo', ios: { app: 'Demo.app' } } }
		);
		const platforms = (raw: string) =>
			new Set(mixed.cells.filter((c) => c.target.raw === raw).map((c) => c.device.platform));
		expect(platforms('/')).toEqual(new Set(['web']));
		expect(platforms('app:/inbox')).toEqual(new Set(['ios']));
		expect(mixed.unmatched).toEqual([]);
	});

	test('a desktop app gets window devices, not phones', () => {
		const desktop = plan({ targets: ['app:/'] }, { desktop: { kind: 'electron', main: '.' } });
		expect(new Set(desktop.cells.map((c) => c.device.platform))).toEqual(new Set(['window']));
	});
});

describe('variants a platform does not apply', () => {
	test('are named in a note', () => {
		const variant = { name: 'x', appearance: 'dark', locale: 'de-DE', contrast: 'forced' } as const;
		expect(notApplied(variant, ['appearance', ['contrast', 'more']], 'here')).toEqual([
			'Not applied here: contrast, locale.'
		]);
		expect(notApplied({ name: 'light', appearance: 'light' }, ['appearance'], 'here')).toEqual([]);
	});
});
