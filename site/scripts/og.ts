// Renders og/og.html to public/og.png, the image link previews show (social sites take PNG or JPEG, not SVG or HTML).
// The PNG is committed next to its source; run `bun run og` after changing it.
import { chromium } from 'playwright';

const source = new URL('../og/og.html', import.meta.url);

const browser = await chromium.launch();
try {
	const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
	await page.goto(source.href, { waitUntil: 'networkidle' });
	await page.evaluate(() => document.fonts.ready);
	const missing = await page.evaluate(() =>
		['300 10px "Noto Sans"', '400 10px "JetBrains Mono"'].filter(
			(font) => !document.fonts.check(font)
		)
	);
	if (missing.length) throw new Error(`Fonts didn't load: ${missing.join(', ')}`);
	await page.screenshot({ path: new URL('../public/og.png', import.meta.url).pathname });
	console.log('Wrote public/og.png');
} finally {
	await browser.close();
}
