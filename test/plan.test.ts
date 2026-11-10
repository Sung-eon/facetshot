import { describe, expect, test } from 'bun:test';
import { parseTarget, plan, resolveVariants, slugify } from '../src/plan.ts';
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
