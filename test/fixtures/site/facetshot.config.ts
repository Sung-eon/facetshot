import { defineConfig } from '../../../src/index.ts';

export default defineConfig({
	web: {
		serve: { cmd: 'bun ../serve-static.ts {port}', port: 'auto' },
		ready: { gone: ['#spinner'] }
	},
	profiles: { default: { on: ['desktop', 'phone'], as: ['light', 'dark'] } }
});
