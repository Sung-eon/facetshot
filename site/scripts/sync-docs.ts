/**
 * Turns the repository's docs/ (and the README's opening for the landing page) into Starlight content, at build
 * time, so the site never holds a second copy of the docs. Everything this writes is generated and gitignored:
 * src/content/docs/, public/images/ and src/sidebar.json.
 *
 * - Each page's title comes from its first `# Heading`, its description from its first paragraph.
 * - Links between docs become site routes; links to other files in the repository become GitHub links.
 * - The sidebar follows docs/README.md's sections, so the index stays the one place that orders the docs.
 */
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

const SITE = join(import.meta.dir, '..');
const REPO = join(SITE, '..');
const DOCS = join(REPO, 'docs');
const BASE = '/facetshot';
const GITHUB = 'https://github.com/Sung-eon/facetshot';
const OUT = join(SITE, 'src', 'content', 'docs');

/** A link target as the site should have it: a route for a doc, a GitHub link for any other repository file. */
function route(target: string, from: string): string {
	if (/^(https?:|mailto:|#)/.test(target)) return target;
	const [path, hash] = target.split('#');
	const file = normalize(join(dirname(from), path));
	const inRepo = relative(REPO, file);
	const anchor = hash ? `#${hash}` : '';
	if (inRepo === 'docs/README.md') return `${BASE}/`;
	// The landing page has its own sections, so a README section is linked where it is: on GitHub.
	if (inRepo === 'README.md') return hash ? `${GITHUB}${anchor}` : `${BASE}/`;
	if (inRepo.startsWith('docs/images/'))
		return `${BASE}/images/${inRepo.slice('docs/images/'.length)}`;
	if (inRepo.startsWith('docs/') && inRepo.endsWith('.md'))
		return `${BASE}/${inRepo.slice(5, -3)}/${anchor}`;
	const isFolder = existsSync(file) && !/\.[a-z0-9]+$/i.test(file);
	return `${GITHUB}/${isFolder ? 'tree' : 'blob'}/main/${inRepo}${anchor}`;
}

/** Rewrites Markdown links and images outside code, and the few HTML img tags the README uses. */
function rewrite(markdown: string, from: string): string {
	const lines = markdown.split('\n');
	let fence: string | undefined;
	return lines
		.map((line) => {
			const marker = /^\s*(```+|~~~+)/.exec(line)?.[1];
			if (marker) {
				if (!fence) fence = marker;
				else if (marker.startsWith(fence[0]) && marker.length >= fence.length) fence = undefined;
				return line;
			}
			if (fence) return line;
			// Inline code keeps its text: split around backticks and rewrite only the parts outside them.
			return line
				.split(/(`[^`]*`)/)
				.map((part) =>
					part.startsWith('`')
						? part
						: part
								.replace(
									/(\]\()([^)\s]+)(\))/g,
									(_, open, target, close) => open + route(target, from) + close
								)
								.replace(
									/(src=")([^"]+)(")/g,
									(_, open, target, close) => open + route(target, from) + close
								)
				)
				.join('');
		})
		.join('\n');
}

/** The first paragraph as plain text, for the page's description. */
function describe(body: string): string {
	const paragraph = body
		.split(/\n\s*\n/)
		.map((each) => each.trim())
		.find((each) => each && !/^(#|```|\||>|-|\d+\.|<)/.test(each));
	if (!paragraph) return '';
	const plain = paragraph
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[`*_]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	return plain.length > 200 ? `${plain.slice(0, 197).replace(/\s+\S*$/, '')}…` : plain;
}

const yaml = (text: string) => JSON.stringify(text);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// The docs, one page each. docs/README.md is the index: it becomes the sidebar, not a page.
for (const name of readdirSync(DOCS).filter(
	(each) => each.endsWith('.md') && each !== 'README.md'
)) {
	const from = join(DOCS, name);
	const text = readFileSync(from, 'utf8');
	const heading = /^#\s+(.+)$/m.exec(text);
	const title = heading ? heading[1].trim() : name.replace(/\.md$/, '');
	const body = rewrite(heading ? text.replace(heading[0], '').replace(/^\s+/, '') : text, from);
	writeFileSync(
		join(OUT, name),
		[
			'---',
			`title: ${yaml(title)}`,
			`description: ${yaml(describe(body))}`,
			`editUrl: ${yaml(`${GITHUB}/edit/main/docs/${name}`)}`,
			'---',
			'',
			body
		].join('\n')
	);
}

// The sidebar, from docs/README.md: each `## Section` is a group, each listed link an entry.
const index = readFileSync(join(DOCS, 'README.md'), 'utf8');
const sidebar: { label: string; items: { label: string; slug: string }[] }[] = [];
for (const line of index.split('\n')) {
	const section = /^##\s+(.+)$/.exec(line);
	if (section) sidebar.push({ label: section[1].trim(), items: [] });
	const entry = /^-\s+\[([^\]]+)\]\(([\w-]+)\.md\)/.exec(line);
	if (entry && sidebar.length) sidebar.at(-1)!.items.push({ label: entry[1], slug: entry[2] });
}
writeFileSync(join(SITE, 'src', 'sidebar.json'), `${JSON.stringify(sidebar, null, '\t')}\n`);

// Images: the docs link them, and the landing page shows the contact sheet as its hero, both from public/images.
rmSync(join(SITE, 'public', 'images'), { recursive: true, force: true });
cpSync(join(DOCS, 'images'), join(SITE, 'public', 'images'), { recursive: true });

// The landing page: the hero, what facetshot is, the first run, what it does and works with, and where to go next.
// "What it is" is the README's opening paragraph, so it is written in one place; the rest is the landing page's own
// short tables and cards, each linking to the page that holds the details.
const readmePath = join(REPO, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const paragraphs = (text: string) => text.split(/\n\s*\n/);
/** README Markdown made safe for MDX: `<` and `{` outside code are text, not components or expressions. */
const mdx = (markdown: string) =>
	rewrite(markdown, readmePath)
		.split(/(`[^`]*`)/)
		.map((part) =>
			part.startsWith('`') ? part : part.replace(/</g, '&lt;').replace(/[{}]/g, (c) => `\\${c}`)
		)
		.join('');

const opening = readme
	.slice(readme.indexOf('\n# facetshot\n') + '\n# facetshot\n'.length, readme.indexOf('\n## '))
	.trim();
// "What it is" starts where the tagline stops: the README's first paragraph without its first sentence (the hero's
// tagline says it), and without the rows-and-columns clause (the hero's caption says it).
const what = paragraphs(opening)[0]
	.replace(/^[\s\S]*?\)?\.\s+(?=[A-Z])/, '')
	.replace(/^It puts them\b/, 'facetshot puts the screenshots')
	.replace(/:\s+each\s+row\s+is\s+a\s+device\s+and\s+each\s+column\s+a\s+setting/, '');
// A real session, as docs/sessions.md shows it: the first command and what it prints.
const sessions = readFileSync(join(DOCS, 'sessions.md'), 'utf8');
const transcript = /```\n(\$ facetshot open[\s\S]*?)```/.exec(sessions)?.[1]?.trimEnd();
const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
const release = pkg.version.split('.').slice(0, 2).join('.');

const page = (slug: string) => `${BASE}/${slug}/`;
const needsMac = '<em class="needs">needs a Mac</em>';
const platforms: [string, string, string, boolean?][] = [
	['Web pages', 'Your app, built and served for you, or any live site.', 'web'],
	['Storybook', 'Every story, from a running or built Storybook.', 'storybook'],
	['Electron', "The app's own window, and its main process's output.", 'desktop/#electron'],
	['Tauri', 'The frontend in WebKit, or the real window.', 'desktop/#tauri'],
	['Mac apps', 'A native window, pressed and typed into.', 'desktop/#native-mac-apps', true],
	['iOS simulators', 'iPhone and iPad, upright and sideways.', 'ios', true],
	['SwiftUI', 'Views drawn in a test, without the app.', 'swiftui', true],
	['Flutter', 'One app on the web, macOS and iOS.', 'flutter']
];
const next: [string, string, string][] = [
	['How it works', 'Targets, devices, variants, profiles, and a glossary.', 'concepts'],
	['Flows', 'Saved steps: open a menu, fill a form, run them on every device.', 'flows'],
	['MCP tools', 'The eight tools an agent gets, with every parameter.', 'mcp'],
	['Configuration reference', 'Every key in facetshot.config.ts.', 'configuration'],
	['Checks', 'What each check looks for, and how to turn one off.', 'checks'],
	['Logs', "The page's console and requests, and your servers' output.", 'logs']
];
const more: [string, string][] = [
	['Command reference', 'cli'],
	['Sessions', 'sessions'],
	['Architecture', 'architecture'],
	['Security', 'security'],
	['Troubleshooting', 'troubleshooting']
];

const tagline =
	"Screenshots of your app's screens on several devices and display settings at once, with what looks broken and what it logged. For people and AI coding agents.";
const hero = `<p class="hero-meta">${release} · free and open source (MIT) · runs on your machine, uploads nothing · <a href="${page('status')}">tested on macOS</a></p>
<figure class="hero-sheet"><img src="${BASE}/images/pricing-sheet.jpg" width="1600" height="1323" alt="A contact sheet of a pricing page on desktop, tablet and phone, in light, dark and large text. The plan cards run off the right edge on tablet and phone."><figcaption>The <a href="${GITHUB}/tree/main/examples/vite-react">example app</a>'s pricing page. Each row is a device, each column a display setting. The plan cards run off the edge on tablet and phone.</figcaption></figure>`;

const landing = `---
title: facetshot
description: ${yaml(tagline)}
template: splash
editUrl: false
hero:
  tagline: ${yaml(tagline)}
  image:
    html: ${yaml(hero)}
  actions:
    - text: Get started
      link: ${page('getting-started')}
      icon: right-arrow
    - text: GitHub
      link: ${GITHUB}
      icon: github
      variant: minimal
---

import { LinkCard, Steps } from '@astrojs/starlight/components';

<section class="band">

## What it is

${mdx(what)}

</section>

<section class="band">

## How it compares

facetshot is built on [Playwright](https://playwright.dev), which does all of its browser work. Playwright MCP gives an
agent a general-purpose browser, and visual regression services fail a build when approved screenshots change.
facetshot covers a smaller job: your own app, built, served and signed in, on every device while you work on it.
[How it compares](${page('comparison')}) goes through each tool.

</section>

<section class="band band-sunken">

## First run

<Steps>

1. Install [Bun](https://bun.sh) 1.3 or newer, then facetshot and the browser it uses (Chromium, about 600 MB):

   \`\`\`sh wrap
   bun add -g facetshot && facetshot setup
   \`\`\`

2. Take screenshots of any page, then open the \`.sheet.jpg\` file whose path it prints:

   \`\`\`sh wrap
   facetshot https://example.com
   \`\`\`

3. In your project's folder, write a config (\`facetshot.config.ts\`: your pages and how to start your app) and
   connect your coding agent (\`claude\`, \`cursor\`, \`codex\` or \`all\`). Restart the agent and ask it to "check
   /settings on a phone":

   \`\`\`sh wrap
   facetshot init --agent claude
   \`\`\`

</Steps>

Or try it without installing: \`bunx facetshot https://example.com\`. [Getting started](${page('getting-started')})
covers the rest, including what to do when \`init\` doesn't recognise your project.

</section>

<section class="band">

## What you can do

<div class="table-wrap">

| Task                                                          | Command                                    |
| ------------------------------------------------------------- | ------------------------------------------ |
| Look for problems on the screens a change touched             | \`facetshot check / /settings\`              |
| Review a screen on every device, in light and dark            | \`facetshot /pricing\`                       |
| Reproduce "the menu is cut off on my phone in dark mode"      | \`facetshot /settings --on phone --as dark\` |
| See what your last change did                                 | \`facetshot diff\`                           |
| Compare with a run you saved, such as production's            | \`facetshot / --diff=production\`            |
| Run your release list of pages and flows (saved steps)        | \`facetshot -p release\`                     |
| Put the sheets in a pull request                              | \`facetshot / --format md\`                  |
| Use a screen step by step, as a session                       | \`facetshot open /settings --on phone\`      |

</div>

[Command reference](${page('cli')}) has every command and option.

</section>

<section class="band band-sunken">

## With an AI agent

The agent gets facetshot's MCP server (its tools) and its skill (Markdown that tells it when to look and how).

<div class="table-wrap table-agents">

| Agent             | Command                                                     | Writes                                                 |
| ----------------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| Claude Code       | \`/plugin install facetshot --marketplace Sung-eon/facetshot\` | nothing in the project: the plugin is for all of them |
| Claude Code       | \`facetshot init --agent claude\`                             | \`.mcp.json\`, \`.claude/skills/facetshot/\`               |
| Codex             | \`facetshot init --agent codex\`                              | \`.codex/config.toml\`, \`.agents/skills/facetshot/\`      |
| Cursor            | \`facetshot init --agent cursor\`                             | \`.cursor/mcp.json\`, \`.cursor/rules/facetshot.mdc\`      |
| Other MCP clients | register \`bunx facetshot mcp\` (standard input and output)   | nothing: point the agent at \`skills/facetshot/\`        |

</div>

Restart the agent afterwards. [AI agents](${page('agents')}) says what each file holds;
[MCP tools](${page('mcp')}) lists the tools.

</section>

<section class="band">

## What it works with

<div class="platforms">
${platforms.map(([title, text, slug, mac]) => `\t<a class="platform" href="${slug.includes('#') ? `${BASE}/${slug}` : page(slug)}"><strong>${title}</strong><span>${text}</span>${mac ? needsMac : ''}</a>`).join('\n')}
</div>

</section>
${
	transcript
		? `
<section class="band band-mat">

## A screen, step by step

A session keeps one screen open so you, or an agent, can use it a step at a time. \`open\` prints a screenshot, the
log, and what can be clicked or typed into:

<pre class="transcript">{${JSON.stringify(transcript)}}</pre>

\`facetshot act s-42cb1d "fill:e14=Grace Hopper" click:e18\` then does steps by those refs, and \`close --save\` keeps
the steps that worked as a flow. See [Sessions](${page('sessions')}).

</section>
`
		: ''
}
<section class="band">

## Where to go next

<div class="cards">
${next.map(([title, text, slug]) => `\t<LinkCard title=${yaml(title)} description=${yaml(text)} href="${page(slug)}" />`).join('\n')}
</div>

<p class="more">${more.map(([title, slug]) => `<a href="${page(slug)}">${title}</a>`).join(' · ')}</p>

</section>
`;
writeFileSync(join(OUT, 'index.mdx'), landing);

console.log(`Synced ${readdirSync(OUT).length} pages and the sidebar from docs/.`);
