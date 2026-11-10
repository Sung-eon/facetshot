/**
 * facetshot as an MCP server over stdio, so an agent can look at the app without knowing the command line.
 *
 * Tools, kept few and small on purpose — every tool's schema sits in the agent's context on every turn:
 *   capture  pictures, answered with the contact sheets themselves
 *   check    what is wrong on the screens, as text (cheapest)
 *   compare  what changed since the last run or a baseline
 *   inspect  one picture at full size, or a part of it, with what its page logged
 *   list     devices, variants, profiles, scenes and recent runs
 *   open     a page kept open to work step by step (a session)
 *   act      steps in a session — click, type, right-click, scroll — then the picture, logs and what's clickable
 *   close    ends a session, optionally keeping its steps as a flow
 *
 * Runs go through the daemon like the command line's, so several agents' servers share one browser and the
 * machine's caps.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from '../config.ts';
import { explain } from '../errors.ts';
import { groupFindings, summarize } from '../output/manifest.ts';
import { crop, encodePng, fit, readPng } from '../output/image.ts';
import { allDevices, allVariants } from '../plan.ts';
import { GROUPS, PROFILES, VARIANT_GROUPS } from '../presets.ts';
import { CHECK_HELP } from '../checks/page.ts';
import { listRuns, readManifest, stateDir, type RunRequest } from '../run.ts';
import type { Manifest } from '../types.ts';
import { VERSION } from '../version.ts';
import { parseStep } from '../flows.ts';
import { describeView, type View } from '../session.ts';

/** How much image a single answer may carry: sheets, and the longest side of an inspected picture. */
const MAX_SHEETS = Number(process.env.FACETSHOT_MCP_MAX_IMAGES ?? 4);
const MAX_SIDE = 1568;

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

const configFile = () => process.env.FACETSHOT_CONFIG;
const cwd = () => process.env.FACETSHOT_CWD ?? process.cwd();

async function execute(
	request: RunRequest,
	progress: (done: number, total: number, message: string) => void
): Promise<Manifest> {
	const loaded = await loadConfig({ file: configFile(), cwd: cwd() });
	const state = stateDir(loaded.config);
	mkdirSync(state, { recursive: true });
	writeFileSync(join(state, 'last-request.json'), JSON.stringify(request));
	const { runViaDaemon } = await import('../daemon/client.ts');
	return runViaDaemon(request, {
		configFile: loaded.file,
		cwd: cwd(),
		log: (message) => progress(0, 0, message),
		onCell: (result, done, total) =>
			progress(done, total, `${result.screen} ${result.device}/${result.variant}`)
	});
}

function sheets(manifest: Manifest, onlyChanged = false): Content[] {
	const chosen = manifest.screens.filter(
		(screen) => screen.sheet && (!onlyChanged || screen.changed)
	);
	const shown = chosen.slice(0, MAX_SHEETS);
	const content: Content[] = shown.map((screen) => ({
		type: 'image',
		data: readFileSync(join(manifest.out, screen.sheet!)).toString('base64'),
		mimeType: 'image/jpeg'
	}));
	if (chosen.length > shown.length) {
		content.push({
			type: 'text',
			text: `${chosen.length - shown.length} more sheet(s) not shown to save space: ${chosen
				.slice(shown.length)
				.map((screen) => screen.screen)
				.join(', ')}. Ask for them with capture on those targets, or inspect a cell.`
		});
	}
	return content;
}

/** Each picture on its own, scaled to fit 1024 px, at most MAX_CELLS of them. */
const MAX_CELLS = Number(process.env.FACETSHOT_MCP_MAX_CELLS ?? 8);
function cellImages(manifest: Manifest): Content[] {
	const cells = manifest.cells.filter((cell) => cell.image);
	const content: Content[] = cells.slice(0, MAX_CELLS).flatMap((cell) => [
		{ type: 'text' as const, text: `${cell.screen} · ${cell.device} · ${cell.variant}` },
		{
			type: 'image' as const,
			data: encodePng(fit(readPng(join(manifest.out, cell.image!)), 1024)).toString('base64'),
			mimeType: 'image/png'
		}
	]);
	if (cells.length > MAX_CELLS) {
		content.push({
			type: 'text',
			text: `${cells.length - MAX_CELLS} more picture(s) not shown; use images: "sheets", fewer devices or variants, or inspect.`
		});
	}
	return content;
}

const failure = (error: unknown) => ({
	content: [{ type: 'text' as const, text: explain(error) }],
	isError: true
});

export function createServer(): McpServer {
	const server = new McpServer(
		{ name: 'facetshot', version: VERSION },
		{
			instructions:
				'Use facetshot to see the app the way users do, after changing UI code and before saying it looks right. ' +
				'Start with `check` (text only, cheap) to find broken screens, `capture` the ones worth seeing, fix, then `compare`. ' +
				'Never write your own screenshot script. Targets: "/path" for web pages, "app:/path" for app screens, ' +
				'"story:id" for Storybook, "preview:Name" for SwiftUI scenes, a flow file for clicks and typing.'
		}
	);

	const progressOf = (extra: {
		_meta?: { progressToken?: string | number };
		sendNotification: (n: never) => Promise<void>;
	}) => {
		const token = extra._meta?.progressToken;
		return (done: number, total: number, message: string) => {
			if (token === undefined) return;
			void extra
				.sendNotification({
					method: 'notifications/progress',
					params: { progressToken: token, progress: done, ...(total ? { total } : {}), message }
				} as never)
				.catch(() => {});
		};
	};

	const targetsShape = {
		targets: z
			.array(z.string())
			.min(1)
			.describe(
				'What to look at: "/settings" (web), "app:/talk" (app), "story:button--primary", "preview:Book/Page", "flows/x.yaml". Aliases from the config work too.'
			),
		devices: z
			.array(z.string())
			.optional()
			.describe('Devices or groups, e.g. ["phone","desktop"]. Default: the profile\'s (see list).'),
		variants: z
			.array(z.string())
			.optional()
			.describe(
				'Variants, e.g. ["light","dark","large"]; "dark+large" combines. Default: the profile\'s.'
			),
		profile: z.string().optional().describe('A named set of devices and variants from the config.'),
		steps: z
			.array(z.string())
			.optional()
			.describe(
				'Steps before each picture, to reach a menu, dialog or half-filled form: "click:role=button[name=\'Delete\']", "fill:#email=a@b.co", "press:Enter", "wait:role=dialog", "shot:confirm" (a picture; without any, one at the end).'
			)
	};
	type TargetsArgs = {
		targets: string[];
		devices?: string[];
		variants?: string[];
		profile?: string;
		steps?: string[];
	};
	const requestOf = (args: TargetsArgs): RunRequest => ({
		targets: args.targets,
		on: args.devices,
		as: args.variants,
		profile: args.profile,
		steps: args.steps?.map(parseStep)
	});

	server.registerTool(
		'capture',
		{
			title: 'Take pictures',
			description:
				'Takes pictures of screens on several devices and variants and returns one contact sheet per screen (rows = devices, columns = variants), plus a short summary of failures and problems found.',
			inputSchema: {
				...targetsShape,
				diff: z.string().optional().describe('Also compare with "previous" or a baseline name.'),
				images: z
					.enum(['sheets', 'cells', 'none'])
					.default('sheets')
					.describe(
						'How pictures come back: "sheets" one grid per screen (default, cheapest to read), "cells" every picture on its own (for a few cells, to read details), "none" paths only.'
					)
			},
			annotations: { readOnlyHint: true, openWorldHint: false }
		},
		async (args, extra) => {
			try {
				const manifest = await execute(
					{ ...requestOf(args), diff: args.diff },
					progressOf(extra as never)
				);
				const pictures =
					args.images === 'none'
						? []
						: args.images === 'cells'
							? cellImages(manifest)
							: sheets(manifest);
				return {
					content: [{ type: 'text', text: summarize(manifest, { absolute: true }) }, ...pictures]
				};
			} catch (error) {
				return failure(error);
			}
		}
	);

	server.registerTool(
		'check',
		{
			title: 'Check screens',
			description:
				'Reads screens for problems without taking pictures: console errors, failed requests, sideways scrolling, cut-off text, covered buttons, broken images, blank pages, small tap targets (and accessibility with checks=["all"]). Cheapest way to find what to look at.',
			inputSchema: {
				...targetsShape,
				checks: z
					.array(z.string())
					.optional()
					.describe('Which checks; default all but accessibility. "all" adds axe-core.')
			},
			annotations: { readOnlyHint: true, openWorldHint: false }
		},
		async (args, extra) => {
			try {
				const manifest = await execute(
					{ ...requestOf(args), checks: args.checks, checkOnly: true },
					progressOf(extra as never)
				);
				const findings = groupFindings(manifest);
				const text = findings.length
					? summarize(manifest)
					: `No problems found on ${manifest.screens.length} screen(s) × ${manifest.devices.length} device(s) × ${manifest.variants.length} variant(s).` +
						(manifest.counts.failed ? `\n${summarize(manifest)}` : '');
				return { content: [{ type: 'text', text }] };
			} catch (error) {
				return failure(error);
			}
		}
	);

	server.registerTool(
		'compare',
		{
			title: 'Compare with before',
			description:
				'Takes the same pictures again (the last capture, or the targets given) and shows only what changed since the previous run or a saved baseline.',
			inputSchema: {
				targets: targetsShape.targets.optional(),
				devices: targetsShape.devices,
				variants: targetsShape.variants,
				against: z.string().optional().describe('"previous" (default) or a baseline name.')
			},
			annotations: { readOnlyHint: true, openWorldHint: false }
		},
		async (args, extra) => {
			try {
				let request: RunRequest;
				if (args.targets?.length)
					request = { targets: args.targets, on: args.devices, as: args.variants };
				else {
					const loaded = await loadConfig({ file: configFile(), cwd: cwd() });
					const file = join(stateDir(loaded.config), 'last-request.json');
					if (!existsSync(file))
						throw new Error('Nothing to repeat yet: capture something first, or give targets.');
					request = JSON.parse(readFileSync(file, 'utf8')) as RunRequest;
				}
				const manifest = await execute(
					{ ...request, checkOnly: false, diff: args.against ?? 'previous' },
					progressOf(extra as never)
				);
				const changed = manifest.screens.filter((screen) => screen.changed);
				const head = changed.length
					? `${changed.length} of ${manifest.screens.length} screen(s) changed: ${changed.map((s) => s.screen).join(', ')}. Changed cells have a red outline.`
					: `Nothing changed on ${manifest.screens.length} screen(s).`;
				return {
					content: [
						{ type: 'text', text: `${head}\n\n${summarize(manifest, { absolute: true })}` },
						...sheets(manifest, true)
					]
				};
			} catch (error) {
				return failure(error);
			}
		}
	);

	server.registerTool(
		'inspect',
		{
			title: 'Look closer',
			description:
				'Returns one picture from a run at full size (scaled to fit 1568 px), or a region of it. Use after capture when a sheet is too small to read.',
			inputSchema: {
				screen: z.string().describe('The screen name as the summary shows it.'),
				device: z.string(),
				variant: z.string(),
				run: z.string().optional().describe('A run id; default the latest.'),
				region: z
					.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
					.optional()
					.describe(
						'A part of the screen in CSS pixels/points (multiplied by the device scale for you).'
					),
				diff: z
					.boolean()
					.optional()
					.describe('Show the difference image instead (if the run compared).')
			},
			annotations: { readOnlyHint: true, openWorldHint: false }
		},
		async (args) => {
			try {
				const loaded = await loadConfig({ file: configFile(), cwd: cwd() });
				const runs = listRuns(loaded.config);
				const id = args.run ?? runs[0];
				if (!id) throw new Error('There are no runs yet.');
				const manifest = readManifest(join(stateDir(loaded.config), 'runs', id));
				if (!manifest) throw new Error(`Run ${id} has no manifest.`);
				const cell = manifest.cells.find(
					(c) => c.screen === args.screen && c.device === args.device && c.variant === args.variant
				);
				if (!cell) {
					throw new Error(
						`No picture for ${args.screen} ${args.device}/${args.variant} in run ${id}. Screens: ${manifest.screens.map((s) => s.screen).join(', ')}.`
					);
				}
				const rel = args.diff ? cell.diff?.image : cell.image;
				if (!rel)
					throw new Error(
						args.diff
							? 'That picture has no difference image.'
							: `That picture failed: ${cell.error ?? 'no image'}.`
					);
				let image = readPng(join(manifest.out, rel));
				if (args.region) {
					// Pixels per point: the picture's width over the device's.
					const device = allDevices(loaded.config)[args.device];
					const deviceScale = device ? image.width / device.width : 1;
					image = crop(image, {
						x: args.region.x * deviceScale,
						y: args.region.y * deviceScale,
						width: args.region.width * deviceScale,
						height: args.region.height * deviceScale
					});
				}
				const findings = (cell.findings ?? []).filter((f) => f.severity !== 'info');
				const text =
					`${args.screen} on ${args.device}, ${args.variant} (run ${id}).` +
					(findings.length
						? `\n${findings.map((f) => `- ${f.check}: ${f.message}${f.where ? ` — ${f.where}` : ''}`).join('\n')}`
						: '') +
					(cell.notes?.length ? `\n${cell.notes.join('\n')}` : '') +
					cellLog(manifest, `${args.screen} · ${args.device} · ${args.variant}`);
				return {
					content: [
						{ type: 'text', text },
						{
							type: 'image',
							data: encodePng(fit(image, MAX_SIDE)).toString('base64'),
							mimeType: 'image/png'
						}
					]
				};
			} catch (error) {
				return failure(error);
			}
		}
	);

	server.registerTool(
		'list',
		{
			title: 'What can be shot',
			description: 'Lists devices, variants, profiles, checks, or recent runs (and their screens).',
			inputSchema: {
				what: z.enum(['devices', 'variants', 'profiles', 'checks', 'runs']).default('devices')
			},
			annotations: { readOnlyHint: true, openWorldHint: false }
		},
		async (args) => {
			try {
				const { config } = await loadConfig({ file: configFile(), cwd: cwd() });
				let text = '';
				if (args.what === 'devices') {
					text = Object.values(allDevices(config))
						.map((d) => `${d.name} (${d.platform}) ${d.width}×${d.height}`)
						.join('\n');
					text += `\nGroups: ${Object.entries({ ...GROUPS, ...config.groups })
						.map(([name, members]) => `${name}=${members.join('+')}`)
						.join(', ')}`;
				} else if (args.what === 'variants') {
					text = Object.values(allVariants(config))
						.map(
							({ name, ...axes }) =>
								`${name}: ${Object.entries(axes)
									.map(([k, v]) => `${k}=${v}`)
									.join(' ')}`
						)
						.join('\n');
					text += `\nGroups: ${Object.entries(VARIANT_GROUPS)
						.map(([n, m]) => `${n}=${m.join('+')}`)
						.join(', ')}. Combine with "+".`;
				} else if (args.what === 'profiles') {
					text = Object.entries({ ...PROFILES, ...config.profiles })
						.map(([name, p]) => `${name}: on ${p.on.join(', ')} as ${p.as.join(', ')}`)
						.join('\n');
				} else if (args.what === 'checks') {
					text = Object.entries(CHECK_HELP)
						.map(([name, help]) => `${name}: ${help}`)
						.join('\n');
				} else {
					text =
						listRuns(config)
							.slice(0, 10)
							.map((id) => {
								const m = readManifest(join(stateDir(config), 'runs', id));
								return `${id}: ${m ? `${m.counts.ok}/${m.cells.length} ok — ${m.screens.map((s) => s.screen).join(', ')}` : 'incomplete'}`;
							})
							.join('\n') || 'No runs yet.';
				}
				return { content: [{ type: 'text', text }] };
			} catch (error) {
				return failure(error);
			}
		}
	);

	const viewContent = (view: View): Content[] => [
		{ type: 'text', text: describeView(view) },
		{
			type: 'image',
			data: encodePng(fit(readPng(view.image), MAX_SIDE)).toString('base64'),
			mimeType: 'image/png'
		}
	];
	const lookShape = {
		elements: z
			.boolean()
			.optional()
			.describe(
				'List what can be clicked or typed into, numbered: a step can then say "click:#3". Default true for open, false for act.'
			),
		full: z.boolean().optional().describe('Picture the whole page, not just the screen.'),
		logLevel: z
			.enum(['debug', 'info', 'warn', 'error'])
			.optional()
			.describe('The least important log lines to return (default info; debug adds every request).')
	};

	server.registerTool(
		'open',
		{
			title: 'Open a page to work',
			description:
				"Opens a web page and keeps it open (a session) on one device and variant, with the project's servers and sign-in. Returns the session id, a picture (CSS pixels), what the page logged, and what on screen can be clicked or typed into. Then use act. Close it when done.",
			inputSchema: {
				target: z.string().describe('A path ("/settings") or a full URL.'),
				device: z
					.string()
					.optional()
					.describe('One device, e.g. "phone". Default: the profile\'s first.'),
				variant: z
					.string()
					.optional()
					.describe('One variant, e.g. "dark". Default: the profile\'s first.'),
				...lookShape
			},
			annotations: { readOnlyHint: false, openWorldHint: false }
		},
		async (args) => {
			try {
				const { sessionCall } = await import('../daemon/client.ts');
				const loaded = await loadConfig({ file: configFile(), cwd: cwd() });
				const view = await sessionCall<View>('open', {
					open: { target: args.target, on: args.device, as: args.variant },
					configFile: loaded.file,
					cwd: cwd(),
					env: process.env
				});
				opened.add(view.session);
				return { content: viewContent(view) };
			} catch (error) {
				return failure(error);
			}
		}
	);

	server.registerTool(
		'act',
		{
			title: 'Work an open page',
			description:
				'Does steps in an open session, in order, stopping at the first that fails, then returns the picture, the log lines since the last look, console errors and failed requests. With no steps, just looks again. Elements: a selector ("text=Save", "role=button[name=\'Save\']"), "#n" from the list, or "@x,y" on the picture.',
			inputSchema: {
				session: z.string().describe('The id open returned, e.g. "s-1a2b3c".'),
				steps: z
					.array(z.string())
					.default([])
					.describe(
						'e.g. "click:#3", "rightclick:@420,180", "dblclick:text=Title", "longpress:#5", "hover:#2", "fill:#4=hello", "type:abc", "press:Meta+K", "select:#6=Large", "drag:#7>#9", "scroll:600", "scroll:#list=400", "wait:role=dialog", "goto:/other", "back".'
					),
				...lookShape
			},
			annotations: { readOnlyHint: false, openWorldHint: false }
		},
		async (args) => {
			try {
				const { sessionCall } = await import('../daemon/client.ts');
				const options = { elements: args.elements, full: args.full, logLevel: args.logLevel };
				const view = args.steps.length
					? await sessionCall<View>('act', {
							id: args.session,
							steps: args.steps.map(parseStep),
							options
						})
					: await sessionCall<View>('look', { id: args.session, options });
				return { content: viewContent(view), isError: view.failed ? true : undefined };
			} catch (error) {
				return failure(error);
			}
		}
	);

	server.registerTool(
		'close',
		{
			title: 'Close a page',
			description:
				'Closes a session. With saveAs, the steps that worked are kept as a flow file that capture can play again on every device.',
			inputSchema: {
				session: z.string(),
				saveAs: z
					.string()
					.optional()
					.describe('A flow file to write, e.g. "flows/delete-account.yaml".')
			},
			annotations: { readOnlyHint: false, openWorldHint: false }
		},
		async (args) => {
			try {
				const { sessionCall } = await import('../daemon/client.ts');
				const answer = await sessionCall<{ closed: string; saved?: string }>('close', {
					id: args.session,
					save: args.saveAs ? join(cwd(), args.saveAs) : undefined
				});
				opened.delete(args.session);
				return {
					content: [
						{
							type: 'text',
							text: `Closed ${answer.closed}.${answer.saved ? ` Steps saved to ${answer.saved}; capture it with targets: ["${args.saveAs}"].` : ''}`
						}
					]
				};
			} catch (error) {
				return failure(error);
			}
		}
	);

	return server;
}

/** Sessions this server opened and hasn't closed: closed when the agent goes. */
const opened = new Set<string>();

/** A picture's log lines from its run, for inspect. */
function cellLog(manifest: Manifest, label: string): string {
	if (!manifest.logs) return '';
	const file = join(manifest.out, manifest.logs.json);
	if (!existsSync(file)) return '';
	const lines = readFileSync(file, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map(
			(line) =>
				JSON.parse(line) as { at: string; of: string; source: string; level: string; text: string }
		)
		.filter((entry) => entry.of === label && entry.level !== 'debug');
	if (!lines.length) return '';
	const origin = Date.parse(lines[0].at);
	const shown = lines
		.slice(-60)
		.map(
			(entry) =>
				`  +${((Date.parse(entry.at) - origin) / 1000).toFixed(2)}s ${entry.level.toUpperCase().padEnd(5)} ${entry.source} ${entry.text}`
		);
	return `\n\nLogs (${lines.length}${lines.length > 60 ? ', last 60' : ''}):\n${shown.join('\n')}`;
}

export async function serveMcp(): Promise<void> {
	const server = createServer();
	await server.connect(new StdioServerTransport());
	// Stays up until the client closes stdin, or a signal ends it: either way through `process.exit`, so whatever a
	// run in this process started is killed as it goes (see `track` in engine/procs.ts).
	for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
		process.once(signal, () => process.exit(0));
	await new Promise<void>((done) => process.stdin.once('close', done));
	if (opened.size) {
		const { sessionCall } = await import('../daemon/client.ts');
		await Promise.race([
			Promise.allSettled([...opened].map((id) => sessionCall('close', { id }))),
			new Promise((done) => setTimeout(done, 5000))
		]);
	}
}
