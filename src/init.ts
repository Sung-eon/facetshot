/**
 * `facetshot init`: a starter config made from what the project already is, and (with `--agent`) the agent
 * connected — the MCP server registered and the skill copied where that agent reads skills.
 */
import { createInterface } from 'node:readline/promises';
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmdirSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_NAMES } from './config.ts';
import { EXIT, UsageError } from './errors.ts';

interface Detected {
	web?: { build: string; serve: string; inputs: string[] };
	storybook?: boolean;
	electron?: boolean;
	tauri?: boolean;
	swift?: string;
	xcode?: string;
	runner: 'bun' | 'npx';
}

function readJson(file: string): Record<string, unknown> | undefined {
	try {
		return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

export function detect(root: string): Detected {
	const pkg = readJson(join(root, 'package.json')) ?? {};
	const deps = { ...(pkg.dependencies as object), ...(pkg.devDependencies as object) } as Record<
		string,
		string
	>;
	const runner =
		existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb')) ? 'bun' : 'npx';
	const x = runner === 'bun' ? 'bunx --bun' : 'npx';
	const found: Detected = { runner };
	if (deps['next']) {
		found.web = {
			build: `${x} next build`,
			serve: `${x} next start -p {port}`,
			inputs: ['app', 'pages', 'src', 'public', 'package.json']
		};
	} else if (deps['@sveltejs/kit'] || deps['vite'] || deps['astro'] || deps['nuxt']) {
		const tool = deps['astro'] ? 'astro' : deps['nuxt'] ? 'nuxt' : 'vite';
		found.web = {
			build: `${x} ${tool} build`,
			serve:
				tool === 'nuxt'
					? `${x} nuxt preview --port {port}`
					: `${x} ${tool} preview --port {port} --strictPort`,
			inputs: ['src', 'public', 'static', 'index.html', 'package.json'].filter((each) =>
				existsSync(join(root, each))
			)
		};
	}
	found.storybook = Object.keys(deps).some(
		(name) => name === 'storybook' || name.startsWith('@storybook/')
	);
	found.electron = !!deps['electron'];
	found.tauri = !!deps['@tauri-apps/api'] || existsSync(join(root, 'src-tauri'));
	if (existsSync(join(root, 'Package.swift'))) found.swift = '.';
	found.xcode = readdirSync(root).find((name) => name.endsWith('.xcodeproj'));
	return found;
}

function configText(found: Detected, url?: string, installed = true): string {
	const parts: string[] = [];
	if (url) {
		parts.push(`	web: {
		// The app is already running here (yours, staging or production); facetshot only visits it.
		baseURL: '${url}'
	},`);
	} else if (found.web) {
		parts.push(`	web: {
		// A production build, rebuilt only when these inputs change, and its preview server.
		build: { cmd: '${found.web.build}', inputs: ${JSON.stringify(found.web.inputs)} },
		serve: { cmd: '${found.web.serve}', port: 'auto' },
		// What "ready" means beyond a quiet network and loaded fonts: spinners that must be gone.
		ready: { gone: ['[aria-busy=true]', '.spinner', '.skeleton'] }
	},`);
	}
	if (found.storybook)
		parts.push(
			`	storybook: { build: { cmd: '${found.runner === 'bun' ? 'bunx --bun' : 'npx'} storybook build -o storybook-static', inputs: ['src', '.storybook'], output: 'storybook-static' } },`
		);
	if (found.electron) parts.push(`	desktop: { kind: 'electron', main: '.', navigate: 'hash' },`);
	else if (found.tauri)
		parts.push(
			`	desktop: { kind: 'tauri', frontend: { cmd: 'npx vite --port {port} --strictPort', port: 'auto' } },`
		);
	if (found.swift)
		parts.push(`	// SwiftUI scenes rendered without launching the app: see the FacetshotKit README.
	swift: { package: '${found.swift}', test: 'YourAppTests/FacetshotRender' },`);
	parts.push(`	profiles: {
		// What \`facetshot <targets>\` uses when you don't say --on/--as.
		default: { on: ['review'], as: ['light', 'dark'] }
	}`);
	// Installed in the project, the config gets types through defineConfig; run with npx alone, it is a plain object,
	// since an import of a package that isn't installed would fail.
	return installed
		? `import { defineConfig } from 'facetshot';

export default defineConfig({
${parts.join('\n')}
});
`
		: `export default {
${parts.join('\n')}
};
`;
}

/** How this project should start facetshot's MCP server. */
function mcpCommand(root: string): { command: string; args: string[] } {
	const cli = fileURLToPath(new URL('./cli.ts', import.meta.url));
	if (cli.includes(`${join('node_modules', 'facetshot')}`))
		return { command: 'bunx', args: ['facetshot', 'mcp'] };
	// Running from a checkout (not installed from npm): point at it, relative to the project when inside it.
	const rel = relative(root, cli);
	return { command: 'bun', args: ['--bun', rel.startsWith('..') ? cli : rel, 'mcp'] };
}

function mergeMcp(file: string, server: { command: string; args: string[] }): boolean {
	const existing = (readJson(file) ?? {}) as { mcpServers?: Record<string, unknown> };
	existing.mcpServers ??= {};
	const already = JSON.stringify(existing.mcpServers.facetshot) === JSON.stringify(server);
	existing.mcpServers.facetshot = server;
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(existing, null, 2)}\n`);
	return !already;
}

const SKILL = fileURLToPath(new URL('../skills/facetshot', import.meta.url));

/**
 * The skill as one Cursor rule: a rule is a single file, so the references follow the body in a fixed order, and
 * links to `references/<name>.md` (and to sections in them) become links to those sections below.
 */
function cursorRule(): string {
	const folder = join(SKILL, 'references');
	const names = readdirSync(folder)
		.filter((name) => name.endsWith('.md'))
		.sort();
	const local = (text: string) =>
		text.replace(
			/\]\((?:references\/)?([\w-]+)\.md(#[\w-]+)?\)/g,
			(_, name: string, anchor?: string) =>
				names.includes(`${name}.md`) ? `](${anchor ?? `#${name}`})` : `](${name}.md${anchor ?? ''})`
		);
	const body = readFileSync(join(SKILL, 'SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\n/, '');
	const references = names.map(
		(name) =>
			`<a id="${name.replace(/\.md$/, '')}"></a>\n\n${local(readFileSync(join(folder, name), 'utf8')).trimEnd()}`
	);
	return `---\ndescription: Seeing and trying the app's screens with facetshot\nalwaysApply: false\n---\n${[local(body).trimEnd(), ...references].join('\n\n')}\n`;
}

/**
 * Puts the skill where an agent reads skills. Inside the same project (facetshot vendored or in a monorepo) it is a
 * link, so the skill is never a second copy that drifts; installed from npm, it is a copy.
 */
function installSkill(root: string, target: string): void {
	const destination = join(root, target);
	mkdirSync(dirname(destination), { recursive: true });
	if (
		existsSync(destination) ||
		(() => {
			try {
				return lstatSync(destination).isSymbolicLink();
			} catch {
				return false;
			}
		})()
	) {
		rmSync(destination, { recursive: true, force: true });
	}
	const rel = relative(dirname(destination), SKILL);
	if (!relative(root, SKILL).startsWith('..') && !SKILL.includes(join('node_modules', 'facetshot')))
		symlinkSync(rel, destination);
	else cpSync(SKILL, destination, { recursive: true });
}
/**
 * Where `init --agent` writes, in one place, so that `undoAgents` below removes exactly what was written and the two
 * can't drift apart.
 */
const PLACES = {
	claudeMcp: '.mcp.json',
	claudeSkill: join('.claude', 'skills', 'facetshot'),
	cursorMcp: join('.cursor', 'mcp.json'),
	cursorRule: join('.cursor', 'rules', 'facetshot.mdc'),
	codexSkill: join('.agents', 'skills', 'facetshot'),
	codexConfig: join('.codex', 'config.toml')
} as const;
const CODEX_SECTION = /^\[mcp_servers\.facetshot\]/m;
const MEMORY_FILES = ['CLAUDE.md', 'AGENTS.md'];

export const AGENT_LINE =
	"To see this app's screens or try what they do, use facetshot (the `facetshot` MCP tools, or the `facetshot` command) instead of a one-off screenshot script, and look before answering from the code.";

export async function init(options: {
	agent?: string;
	yes?: boolean;
	cwd?: string;
	/** An app that is already running, for a project facetshot can't build or start itself. */
	url?: string;
}): Promise<number> {
	const root = options.cwd ?? process.cwd();
	const say = (line: string) => process.stdout.write(`${line}\n`);
	const found = detect(root);
	const url = options.url?.replace(/\/$/, '');
	if (url && !/^https?:\/\/[^/]/.test(url)) {
		throw new UsageError(
			`"${options.url}" isn't an address.`,
			'Give one like http://localhost:3000.'
		);
	}

	const existing = CONFIG_NAMES.map((name) => join(root, name)).find(existsSync);
	const nothing =
		!url && !found.web && !found.storybook && !found.electron && !found.tauri && !found.swift;
	if (existing) say(`Keeping your config: ${existing}`);
	else if (nothing) {
		// Writing a config that guesses would only fail later, further from the reason.
		say(`Found no app to take screenshots of in ${root}`);
		say('(no web framework in package.json, and no Storybook, Electron, Tauri or Swift package).');
		say("- Run this in your project's folder, or");
		say(
			'- for an app that is already running (yours, staging or production): facetshot init --url <address>'
		);
		if (found.xcode)
			say(
				`- for ${found.xcode}: add an \`apple\` section by hand (docs/ios.md); init doesn't write one yet.`
			);
		say('Any page can be captured without a config: facetshot https://example.com');
		// An agent can still be connected: it can take screenshots of full URLs without a config.
		if (!options.agent) return 2;
	} else {
		writeFileSync(
			join(root, 'facetshot.config.ts'),
			configText(found, url, existsSync(join(root, 'node_modules', 'facetshot')))
		);
		const what = [
			url ? `the app at ${url}` : found.web && 'a web app',
			found.storybook && 'Storybook',
			found.electron && 'Electron',
			found.tauri && 'Tauri',
			found.swift && 'a Swift package'
		]
			.filter(Boolean)
			.join(', ');
		say(`Wrote facetshot.config.ts${what ? ` for ${what}` : ''}. Try: facetshot / --on phone`);
	}
	if (
		!existsSync(join(root, '.gitignore')) ||
		!readFileSync(join(root, '.gitignore'), 'utf8').includes('.facetshot')
	) {
		say('Add `.facetshot/` to your .gitignore (screenshots and logs live there).');
	}

	const agents =
		options.agent === 'all' ? ['claude', 'cursor', 'codex'] : options.agent ? [options.agent] : [];
	const server = mcpCommand(root);
	for (const agent of agents) {
		switch (agent) {
			case 'claude':
				mergeMcp(join(root, PLACES.claudeMcp), server);
				installSkill(root, PLACES.claudeSkill);
				say(
					'Claude Code: registered the MCP server in .mcp.json and added the skill to .claude/skills/facetshot.'
				);
				break;
			case 'cursor':
				mergeMcp(join(root, PLACES.cursorMcp), server);
				mkdirSync(dirname(join(root, PLACES.cursorRule)), { recursive: true });
				writeFileSync(join(root, PLACES.cursorRule), cursorRule());
				say(
					'Cursor: registered the MCP server in .cursor/mcp.json and added a rule in .cursor/rules/facetshot.mdc.'
				);
				break;
			case 'codex': {
				installSkill(root, PLACES.codexSkill);
				// Codex reads a project's .codex/config.toml once the project is trusted; ~/.codex/config.toml otherwise.
				const file = join(root, PLACES.codexConfig);
				const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
				if (!CODEX_SECTION.test(existing)) {
					mkdirSync(dirname(file), { recursive: true });
					writeFileSync(
						file,
						`${existing.trimEnd()}${existing.trim() ? '\n\n' : ''}[mcp_servers.facetshot]\ncommand = ${JSON.stringify(server.command)}\nargs = ${JSON.stringify(server.args)}\n`
					);
				}
				say(
					'Codex: added the skill to .agents/skills/facetshot and the MCP server to .codex/config.toml ' +
						'(read once you trust this project in Codex; or copy its [mcp_servers.facetshot] to ~/.codex/config.toml).'
				);
				break;
			}
			default:
				throw new UsageError(
					`I don't know the agent "${agent}".`,
					'Use claude, cursor, codex or all.'
				);
		}
	}
	if (agents.length) await addAgentLine(root, agents.includes('claude'), options.yes, say);
	else say('Connect your agent with: facetshot init --agent claude|cursor|codex|all');
	return EXIT.ok;
}

/**
 * The one line in CLAUDE.md or AGENTS.md that makes agents look with facetshot rather than answer from the code or
 * write a screenshot script; agents follow it far more reliably than the skill alone. Asked at a terminal (yes by
 * default), written with --yes, only suggested otherwise. A new file is made when the project has neither.
 */
async function addAgentLine(
	root: string,
	claude: boolean,
	yes: boolean | undefined,
	say: (line: string) => void
) {
	const existing = MEMORY_FILES.map((name) => join(root, name)).find(existsSync);
	const file = existing ?? join(root, claude ? 'CLAUDE.md' : 'AGENTS.md');
	const name = relative(root, file);
	const text = existing ? readFileSync(existing, 'utf8') : '';
	if (text.includes('facetshot'))
		return say(`${name} already mentions facetshot; left it as it is.`);
	let add = yes === true;
	if (!add && process.stdin.isTTY) {
		const ask = createInterface({ input: process.stdin, output: process.stdout });
		say(`Agents use facetshot much more reliably with this line in ${name}:\n  ${AGENT_LINE}`);
		add = !/^n(o)?$/i.test(
			(await ask.question(`${existing ? 'Add it' : `Create ${name} with it`}? [Y/n] `)).trim()
		);
		ask.close();
	}
	if (add) {
		writeFileSync(file, text.trim() ? `${text.trimEnd()}\n\n${AGENT_LINE}\n` : `${AGENT_LINE}\n`);
		say(existing ? `Added one line to ${name}.` : `Created ${name} with one line about facetshot.`);
	} else
		say(`Add this line to ${name} so agents use facetshot (or rerun with --yes):\n  ${AGENT_LINE}`);
}

/** One thing `init --agent` put in a project, and how to take it out again. */
export interface Undo {
	/** The path, relative to the project. */
	path: string;
	/** What happens to it, for the list shown before anything is removed. */
	what: string;
	apply: () => void;
}

/** Removes a folder init made, and the folders above it up to the project, while they are empty. */
function pruneEmpty(root: string, folder: string): void {
	for (
		let dir = join(root, folder);
		relative(root, dir) && !relative(root, dir).startsWith('..');
		dir = dirname(dir)
	) {
		try {
			if (readdirSync(dir).length) return;
			rmdirSync(dir);
		} catch {
			return;
		}
	}
}

/**
 * The inverse of `init --agent`: facetshot's own entries and files, and nothing of anyone else's. Other MCP servers
 * stay; a file is deleted only when nothing but facetshot was in it. The config is left for the person (they may have
 * changed it); the line in CLAUDE.md/AGENTS.md goes only if it is still exactly the line init wrote.
 */
export function undoAgents(root: string): Undo[] {
	const undo: Undo[] = [];
	const present = (path: string) => {
		try {
			lstatSync(join(root, path));
			return true;
		} catch {
			return false;
		}
	};
	for (const path of [PLACES.claudeMcp, PLACES.cursorMcp]) {
		const file = join(root, path);
		const json = readJson(file) as { mcpServers?: Record<string, unknown> } | undefined;
		if (!json?.mcpServers || !('facetshot' in json.mcpServers)) continue;
		delete json.mcpServers.facetshot;
		const empty = !Object.keys(json.mcpServers).length && Object.keys(json).length === 1;
		undo.push({
			path,
			what: empty
				? 'delete (only facetshot was in it)'
				: 'remove the "facetshot" server, keep the rest',
			apply: () => {
				if (empty) {
					rmSync(file, { force: true });
					pruneEmpty(root, dirname(path));
				} else writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
			}
		});
	}
	const codex = join(root, PLACES.codexConfig);
	const toml = existsSync(codex) ? readFileSync(codex, 'utf8') : '';
	if (CODEX_SECTION.test(toml)) {
		const lines = toml.split('\n');
		const start = lines.findIndex((line) => CODEX_SECTION.test(line));
		let end = lines.findIndex((line, index) => index > start && /^\s*\[/.test(line));
		if (end < 0) end = lines.length;
		const rest = [...lines.slice(0, start), ...lines.slice(end)]
			.join('\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim();
		undo.push({
			path: PLACES.codexConfig,
			what: rest
				? 'remove the [mcp_servers.facetshot] section, keep the rest'
				: 'delete (only facetshot was in it)',
			apply: () => {
				if (rest) writeFileSync(codex, `${rest}\n`);
				else {
					rmSync(codex, { force: true });
					pruneEmpty(root, dirname(PLACES.codexConfig));
				}
			}
		});
	}
	for (const path of MEMORY_FILES) {
		const file = join(root, path);
		const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
		if (!text.includes(AGENT_LINE)) continue;
		const rest = text
			.replace(AGENT_LINE, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim();
		undo.push({
			path,
			what: rest
				? 'remove the line about facetshot, keep the rest'
				: 'delete (only the line about facetshot was in it)',
			apply: () => (rest ? writeFileSync(file, `${rest}\n`) : rmSync(file, { force: true }))
		});
	}
	for (const path of [PLACES.claudeSkill, PLACES.codexSkill, PLACES.cursorRule]) {
		if (!present(path)) continue;
		undo.push({
			path,
			what: 'delete',
			apply: () => {
				// Not followed if it is a link (a skill inside a checkout): the link goes, what it points at stays.
				rmSync(join(root, path), { recursive: true, force: true });
				pruneEmpty(root, dirname(path));
			}
		});
	}
	return undo;
}
