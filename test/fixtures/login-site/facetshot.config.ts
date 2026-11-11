import { defineConfig } from '../../../src/index.ts';

// A persona that signs in through a flow: the sign-in runs once and its state is kept for later pages.
export default defineConfig({
	web: {
		serve: { cmd: 'bun ../serve-static.ts {port}', port: 'auto' },
		personas: { member: { login: 'login.yaml' } },
		persona: 'member'
	},
	profiles: { default: { on: ['desktop'], as: ['light'] } }
});
