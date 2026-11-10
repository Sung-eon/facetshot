import { expect, test } from 'bun:test';
import { parseArgs } from '../src/cli.ts';

test('targets come first and run is the default command', () => {
	expect(parseArgs(['/a', '/b', '--on', 'phone,desktop', '--as=dark'])).toEqual({
		command: 'run',
		positional: ['/a', '/b'],
		flags: { on: 'phone,desktop', as: 'dark' }
	});
});

test('--diff alone compares with the previous run', () => {
	expect(parseArgs(['/a', '--diff']).flags.diff).toBe('previous');
	expect(parseArgs(['--diff', '/a']).flags.diff).toBe('previous');
	expect(parseArgs(['/a', '--diff', 'main']).flags.diff).toBe('main');
});

test('a word in front is a command', () => {
	expect(parseArgs(['check', '/a']).command).toBe('check');
	expect(parseArgs(['-p', 'full', '/a']).flags.profile).toBe('full');
});
