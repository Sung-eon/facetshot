import { defineConfig } from '../../src/index.ts';

export default defineConfig({
	desktop: {
		kind: 'tauri',
		// The web UI, built and served the way the app loads it, shot in Playwright's WebKit (Tauri's engine on macOS).
		frontend: {
			build: { cmd: 'bun --bun vite build', inputs: ['src', 'index.html', 'vite.config.ts', 'package.json'], output: 'dist' },
			cmd: 'bun --bun vite preview --port {port} --strictPort',
			port: 'auto'
		},
		// There's no Rust backend in a browser: these answer the frontend's invoke() calls.
		invoke: { greet: 'Hello, Ada! You have 3 things saved.' },
		// For the real window (desktop.engine: 'window', macOS): the built app and its deep-link scheme.
		app: 'src-tauri/target/release/bundle/macos/Pebble.app',
		build: { cmd: 'bun run tauri build --bundles app -- -j 4', inputs: ['src', 'src-tauri/src', 'src-tauri/tauri.conf.json'], heavy: true },
		navigate: 'pebble'
	},
	web: { ready: { visible: ['main h1'] } },
	checks: ['console', 'network', 'overflow', 'clipped'],
	profiles: { default: { on: ['window', 'window-small'], as: ['light', 'dark'] } }
});
