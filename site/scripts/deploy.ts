/**
 * Publishes the built site (dist/) to the repository's gh-pages branch, which GitHub Pages serves. No CI: run it
 * from a clone after `bun run build` (`bun run deploy` does both). The branch holds only the built files.
 */
import { $ } from 'bun';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dist = join(import.meta.dir, '..', 'dist');
if (!existsSync(join(dist, 'index.html')))
	throw new Error('No built site in dist/: run bun run build first.');

const head = (await $`git rev-parse --short HEAD`.text()).trim();
const work = mkdtempSync(join(tmpdir(), 'facetshot-pages-'));
try {
	// A worktree of gh-pages (created empty the first time), refilled with dist/.
	const exists = (await $`git ls-remote --heads origin gh-pages`.text()).trim() !== '';
	if (exists) {
		await $`git fetch origin gh-pages`;
		await $`git worktree add ${work} origin/gh-pages --detach`;
	} else {
		await $`git worktree add ${work} --detach`;
		await $`git -C ${work} checkout --orphan gh-pages`;
	}
	await $`git -C ${work} rm -rf --quiet --ignore-unmatch .`;
	await $`cp -R ${dist}/. ${work}/`;
	// Pages must not run Jekyll over Astro's _astro/ folder.
	writeFileSync(join(work, '.nojekyll'), '');
	await $`git -C ${work} add -A`;
	await $`git -C ${work} commit --quiet -m ${`Site built from ${head}`}`.nothrow();
	await $`git -C ${work} push origin HEAD:gh-pages`;
	console.log('Pushed the site to gh-pages.');
} finally {
	await $`git worktree remove --force ${work}`.nothrow();
	rmSync(work, { recursive: true, force: true });
}
