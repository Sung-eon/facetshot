import { defineConfig } from '../../src/index.ts';

export default defineConfig({
	web: {
		// Flutter's web build is a folder of static files; with no `serve`, facetshot serves it itself.
		build: {
			cmd: 'flutter build web --release',
			inputs: ['lib', 'web', 'pubspec.yaml'],
			output: 'build/web'
		}
	},
	// The same app on macOS: `facetshot app:/settings --on mac`. Built when its inputs change.
	desktop: {
		kind: 'macos',
		build: {
			cmd: 'flutter build macos --release',
			inputs: ['lib', 'macos', 'pubspec.yaml'],
			output: 'build/macos/Build/Products/Release/lantern_flutter.app',
			heavy: true
		}
	},
	checks: ['console', 'network', 'overflow', 'clipped'],
	profiles: { default: { on: ['desktop', 'phone'], as: ['light', 'dark'] } }
});
