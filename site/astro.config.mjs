// The facetshot site: the repository's docs/, rendered with Starlight. Content is generated from docs/ by
// scripts/sync-docs.ts before every build, so the docs live in one place.
import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { codeThemes } from './src/code-themes.mjs';

const sidebar = JSON.parse(readFileSync(new URL('./src/sidebar.json', import.meta.url), 'utf8'));

export default defineConfig({
	site: 'https://gh.sung-eon.space',
	base: '/facetshot',
	trailingSlash: 'always',
	integrations: [
		starlight({
			title: 'facetshot',
			description:
				"Screenshots of your app's screens on several devices and display settings at once, for people and AI coding agents.",
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/Sung-eon/facetshot' }],
			editLink: { baseUrl: 'https://github.com/Sung-eon/facetshot/edit/main/docs/' },
			sidebar,
			customCss: ['./src/styles/custom.css'],
			// Plain code blocks (no empty terminal title bar over a command), in the site's own colours.
			expressiveCode: { themes: codeThemes, defaultProps: { frame: 'code' } },
			// A stacked hero (the contact sheet full width under the title), and a footer line on every page.
			components: { Hero: './src/components/Hero.astro', Footer: './src/components/Footer.astro' },
			head: [
				// Link previews: Starlight sets the title, description and URL; the image is og/og.html, rendered.
				...[
					['og:image', 'https://gh.sung-eon.space/facetshot/og.png'],
					['og:image:width', '1200'],
					['og:image:height', '630'],
					[
						'og:image:alt',
						'facetshot: a contact sheet of a settings screen with its menu open, on desktop and tablet, in light and dark.'
					]
				].map(([property, content]) => ({ tag: 'meta', attrs: { property, content } })),
				{ tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' } },
				{
					tag: 'link',
					attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: true }
				},
				{
					tag: 'link',
					attrs: {
						rel: 'stylesheet',
						href: 'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@200..700&family=JetBrains+Mono:wght@400;600&display=swap'
					}
				}
			]
		})
	]
});
