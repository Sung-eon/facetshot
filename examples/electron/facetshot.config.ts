import { defineConfig } from '../../src/index.ts';

export default defineConfig({
	// `main: '.'` launches this folder with the project's own `electron` package; `navigate: 'hash'` reaches
	// `app:/reports` by setting location.hash to `#/reports`.
	desktop: { kind: 'electron', main: '.', navigate: 'hash' },
	web: { ready: { visible: ['main section:not([hidden]) h1'] } },
	checks: ['console', 'network', 'overflow', 'clipped'],
	profiles: { default: { on: ['window', 'window-small'], as: ['light', 'dark'] } }
});
