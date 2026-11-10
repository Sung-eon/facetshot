#!/usr/bin/env bun
/**
 * The command line. Most of the time it is just `facetshot <targets>`; everything else is a word in front.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.ts';
import { EXIT, explain, FacetshotError, UsageError } from './errors.ts';
import { listRuns, readManifest, stateDir, type RunRequest } from './run.ts';
import { markdown, summarize } from './output/manifest.ts';
import { spawn } from 'node:child_process';

/** Opens a file the way double-clicking it would. */
function openFile(file: string): void {
	const [command, ...args] =
		process.platform === 'darwin'
			? ['open', file]
			: process.platform === 'win32'
				? ['cmd', '/c', 'start', '', file]
				: ['xdg-open', file];
	spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}
import { allDevices, allVariants } from './plan.ts';
import { GROUPS, PROFILES, VARIANT_GROUPS } from './presets.ts';
import { CHECK_HELP } from './checks/page.ts';
import type { CellResult, Manifest } from './types.ts';
import { VERSION } from './version.ts';
import { parseStep } from './flows.ts';

interface Parsed {
	command: string;
	positional: string[];
	flags: Record<string, string | true>;
}

const COMMANDS = [
	'run',
	'check',
	'diff',
	'list',
	'init',
	'doctor',
	'mcp',
	'daemon',
	'baseline',
	'clean',
	'help',
	'version'
];
/** Flags that take a value. Everything else is a switch. */
const VALUED = new Set([
	'on',
	'as',
	'p',
	'profile',
	'checks',
	'out',
	'diff',
	'config',
	'sheet-width',
	'agent',
	'c',
	'do',
	'format'
]);
/** Flags that may be given more than once; their values are kept in order, joined by a newline. */
const REPEATED = new Set(['do']);
const SHORT: Record<string, string> = { p: 'profile', c: 'config', h: 'help', v: 'version' };

export function parseArgs(argv: string[]): Parsed {
	const flags: Record<string, string | true> = {};
	const positional: string[] = [];
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--') {
			positional.push(...argv.slice(i + 1));
			break;
		}
		const long = /^--([\w-]+)(?:=(.*))?$/.exec(arg);
		const short = /^-(\w)$/.exec(arg);
		if (long || short) {
			const raw = long ? long[1] : short![1];
			const name = SHORT[raw] ?? raw;
			if (long?.[2] !== undefined)
				flags[name] =
					REPEATED.has(name) && typeof flags[name] === 'string'
						? `${flags[name]}\n${long[2]}`
						: long[2];
			else if (VALUED.has(raw) || VALUED.has(name)) {
				// `--diff` alone means "compare with the previous run".
				const next = argv[i + 1];
				if (name === 'diff' && (next === undefined || next.startsWith('-') || next.startsWith('/')))
					flags[name] = 'previous';
				else if (next === undefined) throw new UsageError(`--${raw} needs a value.`);
				else {
					flags[name] =
						REPEATED.has(name) && typeof flags[name] === 'string'
							? `${flags[name]}\n${next}`
							: next;
					i += 1;
				}
			} else flags[name] = true;
		} else positional.push(arg);
	}
	const first = positional[0];
	const command = first && COMMANDS.includes(first) ? (positional.shift() as string) : 'run';
	return { command, positional, flags };
}

const list = (value: string | true | undefined) =>
	typeof value === 'string'
		? value
				.split(',')
				.map((item) => item.trim())
				.filter(Boolean)
		: undefined;

const HELP = `facetshot ${VERSION} — every screen, on every device, in every mode, in one command.

Usage
  facetshot <targets…> [--on devices] [--as variants]   take pictures
  facetshot check <targets…>                            read the screens for problems, no pictures
  facetshot diff                                        run the last command again and show what changed
  facetshot list [devices|variants|profiles|checks|runs]
  facetshot init [--agent claude|codex|cursor|all]      write a starter config and connect your agent
  facetshot doctor                                      check this machine and say how to fix what's missing
  facetshot mcp                                         run as an MCP server over stdio (for AI agents)
  facetshot baseline save|list|rm <name>                keep a run to compare against later
  facetshot daemon status|stop                          the background helper that keeps things warm
  facetshot clean                                       remove runs, test data, and anything left running

Targets
  /path or https://…     a web page            app:/path        an app screen (simulator or desktop app)
  story:id or Button/*   Storybook stories      preview:Name     SwiftUI previews
  flows/name.yaml        a flow (clicks, typing, then pictures)

Options
  --on phone,desktop     devices or groups (default: the profile's)
  --as dark,large        variants; combine with + (dark+large)
  -p, --profile name     a named set of devices and variants from your config
  --diff [against]       compare with the previous run, a baseline, or a run id
  --checks a,b|all       which checks to run (facetshot list checks)
  --out folder           write this run to a folder of your choice
  --clean                empty --out first
  --format text|md|json  what to print: a short summary (default), Markdown with the sheets, or the manifest
  --open                 open report.html, every picture on one page, when done
  --do <step>            a step before the picture, repeatable: --do "click:text=Save" --do shot:saved
  --no-daemon            do everything in this process (slower next time)
  -c, --config file      use this config instead of searching for facetshot.config.ts

Docs: https://github.com/facetshot/facetshot#readme`;

function lastRequestFile(state: string) {
	return join(state, 'last-request.json');
}

function progress(): {
	cell: (result: CellResult, done: number, total: number) => void;
	log: (message: string) => void;
	end: () => void;
} {
	const tty = process.stderr.isTTY;
	let line = '';
	const clear = () => {
		if (tty && line) process.stderr.write('\r\x1b[2K');
	};
	return {
		cell(result, done, total) {
			const mark = result.status === 'ok' ? '✓' : '✗';
			const text = `${mark} ${done}/${total} ${result.screen} ${result.device}/${result.variant}`;
			if (tty) {
				clear();
				line = text;
				process.stderr.write(text);
			} else if (result.status !== 'ok') process.stderr.write(`${text}: ${result.error}\n`);
		},
		log(message) {
			clear();
			line = '';
			process.stderr.write(`${message}\n`);
		},
		end() {
			clear();
			line = '';
		}
	};
}

async function shoot(request: RunRequest, flags: Parsed['flags']): Promise<number> {
	const loaded = await loadConfig({
		file: typeof flags.config === 'string' ? flags.config : undefined
	});
	const state = stateDir(loaded.config);
	mkdirSync(state, { recursive: true });
	writeFileSync(lastRequestFile(state), JSON.stringify(request));
	const view = progress();
	let manifest: Manifest;
	if (flags['no-daemon'] || process.env.FACETSHOT_NO_DAEMON) {
		const { run } = await import('./run.ts');
		// Interrupted, a run still stops its servers and removes its test data before exiting. Asked twice, it exits
		// at once; what it started is killed as the process goes (see `track` in engine/procs.ts).
		const controller = new AbortController();
		for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
			process.on(signal, () => {
				if (controller.signal.aborted) process.exit(EXIT.internal);
				view.log(`Stopping (${signal}); cleaning up… (again to stop at once)`);
				controller.abort(new Error(`Stopped by ${signal}.`));
			});
		}
		manifest = await run(request, {
			config: loaded.config,
			log: view.log,
			onCell: view.cell,
			signal: controller.signal
		});
	} else {
		const { runViaDaemon } = await import('./daemon/client.ts');
		manifest = await runViaDaemon(request, {
			configFile: loaded.file,
			cwd: process.cwd(),
			log: view.log,
			onCell: view.cell
		});
	}
	view.end();
	const format = flags.json ? 'json' : typeof flags.format === 'string' ? flags.format : 'text';
	if (format === 'json') process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
	else if (format === 'md') process.stdout.write(markdown(manifest, `${manifest.out}/`));
	else if (format === 'text') process.stdout.write(summarize(manifest, { absolute: true }));
	else throw new UsageError(`Unknown format "${format}".`, 'Use text (default), md or json.');
	if (flags.open) openFile(join(manifest.out, 'report.html'));
	return manifest.counts.failed || manifest.errors.length ? EXIT.someFailed : EXIT.ok;
}

async function listCommand(what: string | undefined, flags: Parsed['flags']): Promise<number> {
	const { config } = await loadConfig({
		file: typeof flags.config === 'string' ? flags.config : undefined
	});
	const out: string[] = [];
	switch (what ?? 'devices') {
		case 'devices': {
			const devices = allDevices(config);
			for (const platform of ['web', 'ios', 'window'] as const) {
				out.push(`${platform}:`);
				for (const device of Object.values(devices).filter((d) => d.platform === platform)) {
					out.push(
						`  ${device.name.padEnd(18)} ${device.width}×${device.height} @${device.scale}x${device.model ? `  ${device.model}` : ''}`
					);
				}
			}
			out.push('groups:');
			for (const [name, members] of Object.entries({ ...GROUPS, ...config.groups }))
				out.push(`  ${name.padEnd(18)} ${members.join(', ')}`);
			break;
		}
		case 'variants': {
			for (const variant of Object.values(allVariants(config))) {
				const { name, ...axes } = variant;
				out.push(
					`  ${name.padEnd(12)} ${Object.entries(axes)
						.map(([k, v]) => `${k}=${v}`)
						.join(' ')}`
				);
			}
			out.push('groups:');
			for (const [name, members] of Object.entries(VARIANT_GROUPS))
				out.push(`  ${name.padEnd(12)} ${members.join(', ')}`);
			out.push('Combine with "+": dark+large');
			break;
		}
		case 'profiles':
			for (const [name, profile] of Object.entries({ ...PROFILES, ...config.profiles })) {
				out.push(`  ${name.padEnd(12)} on ${profile.on.join(', ')}  as ${profile.as.join(', ')}`);
			}
			break;
		case 'checks':
			for (const [name, help] of Object.entries(CHECK_HELP))
				out.push(`  ${name.padEnd(10)} ${help}`);
			break;
		case 'runs':
			for (const id of listRuns(config).slice(0, 20)) {
				const manifest = readManifest(join(stateDir(config), 'runs', id));
				out.push(
					`  ${id}  ${manifest ? `${manifest.counts.ok}/${manifest.cells.length} ok, ${manifest.screens.map((s) => s.screen).join(' ')}` : '(incomplete)'}`
				);
			}
			break;
		default:
			throw new UsageError(
				`I can't list "${what}".`,
				'Try: devices, variants, profiles, checks, runs.'
			);
	}
	process.stdout.write(`${out.join('\n')}\n`);
	return EXIT.ok;
}

async function baselineCommand(
	action: string | undefined,
	name: string | undefined,
	flags: Parsed['flags']
): Promise<number> {
	const { config } = await loadConfig({
		file: typeof flags.config === 'string' ? flags.config : undefined
	});
	const state = stateDir(config);
	const folder = join(state, 'baselines');
	switch (action) {
		case 'save': {
			if (!name) throw new UsageError('Name the baseline: facetshot baseline save main');
			const latest = listRuns(config)[0];
			if (!latest)
				throw new UsageError('There is no run to save yet.', 'Take some pictures first.');
			rmSync(join(folder, name), { recursive: true, force: true });
			cpSync(join(state, 'runs', latest), join(folder, name), { recursive: true });
			process.stdout.write(
				`Saved run ${latest} as baseline "${name}". Compare with: facetshot <targets> --diff ${name}\n`
			);
			return EXIT.ok;
		}
		case 'rm':
			if (!name) throw new UsageError('Which baseline? facetshot baseline rm <name>');
			rmSync(join(folder, name), { recursive: true, force: true });
			return EXIT.ok;
		case 'list':
		case undefined: {
			const names = existsSync(folder) ? (await import('node:fs')).readdirSync(folder) : [];
			process.stdout.write(
				names.length
					? `${names.join('\n')}\n`
					: 'No baselines yet. Save one with: facetshot baseline save <name>\n'
			);
			return EXIT.ok;
		}
		default:
			throw new UsageError(`Unknown baseline action "${action}".`, 'Use save, list or rm.');
	}
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
	const parsed = parseArgs(argv);
	const { command, positional, flags } = parsed;
	if (flags.help || command === 'help') {
		process.stdout.write(`${HELP}\n`);
		return EXIT.ok;
	}
	if (flags.version || command === 'version') {
		process.stdout.write(`${VERSION}\n`);
		return EXIT.ok;
	}
	const request = (checkOnly: boolean): RunRequest => ({
		targets: positional,
		on: list(flags.on),
		as: list(flags.as),
		profile: typeof flags.profile === 'string' ? flags.profile : undefined,
		checks: list(flags.checks),
		diff: typeof flags.diff === 'string' ? flags.diff : undefined,
		out: typeof flags.out === 'string' ? flags.out : undefined,
		clean: flags.clean === true,
		sheetWidth: typeof flags['sheet-width'] === 'string' ? Number(flags['sheet-width']) : undefined,
		steps: typeof flags.do === 'string' ? flags.do.split('\n').map(parseStep) : undefined,
		checkOnly
	});
	switch (command) {
		case 'run':
			if (!positional.length) {
				process.stdout.write(`${HELP}\n`);
				return EXIT.usage;
			}
			return shoot(request(false), flags);
		case 'check':
			return shoot(request(true), flags);
		case 'diff': {
			const { config } = await loadConfig({
				file: typeof flags.config === 'string' ? flags.config : undefined
			});
			const file = lastRequestFile(stateDir(config));
			if (!existsSync(file))
				throw new UsageError(
					'There is no earlier command to repeat.',
					'Run facetshot <targets> first.'
				);
			const last = JSON.parse(readFileSync(file, 'utf8')) as RunRequest;
			return shoot(
				{
					...last,
					checkOnly: false,
					diff: positional[0] ?? (typeof flags.diff === 'string' ? flags.diff : 'previous')
				},
				flags
			);
		}
		case 'list':
			return listCommand(positional[0], flags);
		case 'baseline':
			return baselineCommand(positional[0], positional[1], flags);
		case 'init': {
			const { init } = await import('./init.ts');
			return init({
				agent: typeof flags.agent === 'string' ? flags.agent : undefined,
				yes: flags.yes === true
			});
		}
		case 'doctor': {
			const { doctor } = await import('./doctor.ts');
			return doctor({ configFile: typeof flags.config === 'string' ? flags.config : undefined });
		}
		case 'mcp': {
			const { serveMcp } = await import('./integrations/mcp.ts');
			await serveMcp();
			return EXIT.ok;
		}
		case 'daemon': {
			const { daemonCommand } = await import('./daemon/client.ts');
			return daemonCommand(positional[0] ?? 'status');
		}
		case 'clean': {
			const { clean } = await import('./clean.ts');
			return clean({
				configFile: typeof flags.config === 'string' ? flags.config : undefined,
				all: flags.all === true
			});
		}
		default:
			throw new UsageError(`Unknown command "${command}".`);
	}
}

if (import.meta.main) {
	// A closed pipe (`facetshot … | head`) must not kill the process before it has cleaned up.
	process.on('SIGPIPE', () => {});
	process.stdout.on('error', () => {});
	main().then(
		(code) => process.exit(code),
		(error) => {
			process.stderr.write(`\n${explain(error)}\n`);
			process.exit(error instanceof FacetshotError ? error.exitCode : EXIT.internal);
		}
	);
}
