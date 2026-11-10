import { defineConfig } from '../../src/index.ts';

export default defineConfig({
	web: {
		// Pictures are of the production build, rebuilt only when these inputs change.
		build: { cmd: 'bun --bun vite build', inputs: ['src', 'index.html', 'vite.config.ts', 'package.json'], output: 'dist' },
		serve: { cmd: 'bun --bun vite preview --port {port} --strictPort', port: 'auto' }
	},
	storybook: {
		// A static build that facetshot serves itself; set `url` instead to use a Storybook you already run.
		build: {
			cmd: 'bun run build-storybook',
			inputs: ['src', '.storybook', 'package.json'],
			output: 'storybook-static'
		}
	},
	aliases: { home: '/', pricing: '/pricing', settings: '/settings' },
	checks: ['console', 'network', 'overflow', 'clipped', 'covered'],
	profiles: { default: { on: ['desktop', 'phone'], as: ['light', 'dark'] } }
});
