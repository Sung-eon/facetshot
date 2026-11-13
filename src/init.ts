/**
 * `facetshot init`: a starter config made from what the project already is, and (with `--agent`) the agent
 * connected — the MCP server registered and the skill copied where that agent reads skills.
 */
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
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
 * The skill as one Cursor rule: a rule is a single file, so the reference the skill links to follows its body, and
 * the link becomes a pointer to the section below.
 */
function cursorRule(): string {
	const body = readFileSync(join(SKILL, 'SKILL.md'), 'utf8')
		.replace(/^---[\s\S]*?---\n/, '')
		.replace(/\[reference\.md\]\(reference\.md\)/g, 'the reference below');
	const reference = readFileSync(join(SKILL, 'reference.md'), 'utf8');
	return `---\ndescription: Seeing the app's screens with facetshot\nalwaysApply: false\n---\n${body.trimEnd()}\n\n${reference}`;
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
const AGENT_LINE =
	'To see screens, use facetshot: the `facetshot` MCP tools (check, capture, compare, inspect; open, act and close to use a page step by step) or the `facetshot` command. Never write a screenshot script.';

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
				mergeMcp(join(root, '.mcp.json'), server);
				installSkill(root, join('.claude', 'skills', 'facetshot'));
				say(
					'Claude Code: registered the MCP server in .mcp.json and added the skill to .claude/skills/facetshot.'
				);
				break;
			case 'cursor':
				mergeMcp(join(root, '.cursor', 'mcp.json'), server);
				mkdirSync(join(root, '.cursor', 'rules'), { recursive: true });
				writeFileSync(join(root, '.cursor', 'rules', 'facetshot.mdc'), cursorRule());
				say(
					'Cursor: registered the MCP server in .cursor/mcp.json and added a rule in .cursor/rules/facetshot.mdc.'
				);
				break;
			case 'codex': {
				installSkill(root, join('.agents', 'skills', 'facetshot'));
				// Codex reads a project's .codex/config.toml once the project is trusted; ~/.codex/config.toml otherwise.
				const file = join(root, '.codex', 'config.toml');
				const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
				if (!/^\[mcp_servers\.facetshot\]/m.test(existing)) {
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
	if (agents.length) {
		const memory = ['CLAUDE.md', 'AGENTS.md'].map((name) => join(root, name)).find(existsSync);
		if (memory && options.yes) {
			const text = readFileSync(memory, 'utf8');
			if (!text.includes('facetshot'))
				writeFileSync(memory, `${text.trimEnd()}\n\n${AGENT_LINE}\n`);
			say(`Added one line to ${relative(root, memory)}.`);
		} else {
			say(
				`Consider adding this line to ${memory ? relative(root, memory) : 'AGENTS.md or CLAUDE.md'} (or rerun with --yes):\n  ${AGENT_LINE}`
			);
		}
	} else {
		say('Connect your agent with: facetshot init --agent claude|cursor|codex|all');
	}
	return EXIT.ok;
}
