import { defineConfig } from '../../src/index.ts';

export default defineConfig({
	// `preview:` targets run this package's FacetshotRender test, which draws each scene at each device and variant.
	swift: { package: '.', test: 'ExampleTests/FacetshotRender', scheme: 'SwiftUIExample' },
	profiles: { default: { on: ['mac'], as: ['light', 'dark', 'xxl'] } }
});
