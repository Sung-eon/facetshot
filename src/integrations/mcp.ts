/**
 * facetshot as an MCP server over stdio, so an agent can look at the app without knowing the command line.
 *
 * Tools, kept few and small on purpose — every tool's schema sits in the agent's context on every turn:
 *   capture  screenshots, answered with the contact sheets themselves
 *   check    what is wrong on the screens, as text (cheapest)
 *   compare  what changed since the last run or a baseline
 *   inspect  one screenshot at full size, or a part of it, with what its page logged
 *   list     devices, variants, profiles, flows, checks, recent runs and open sessions
 *   open     a page kept open to work step by step (a session)
 *   act      steps in a session — click, type, right-click, scroll — then the screenshot, logs and what's clickable
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
import { allDevices } from '../plan.ts';
import { listing, LISTS } from '../listing.ts';
import { listRuns, readManifest, stateDir, type RunRequest } from '../run.ts';
import type { CellResult, Manifest } from '../types.ts';
import { VERSION } from '../version.ts';
import { parseStep } from '../flows.ts';
import { describeView, type View } from '../session.ts';
import type { LogLevel } from '../logs.ts';

/** How much image a single answer may carry: sheets, and the longest side of an inspected screenshot. */
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

/** A run as data, for clients that read structured results: where things are and what was found, no screenshots. */
function runData(manifest: Manifest): Record<string, unknown> {
	return {
		runId: manifest.runId,
		out: manifest.out,
		counts: manifest.counts,
		errors: manifest.errors,
		screens: manifest.screens.map((screen) => ({
			...screen,
			sheet: screen.sheet ? join(manifest.out, screen.sheet) : undefined
		})),
		findings: groupFindings(manifest).map(({ finding, screen, where }) => ({
			...finding,
			screen,
			cells: where
		})),
		logs: manifest.logs
			? {
					...manifest.logs,
					text: join(manifest.out, manifest.logs.text),
					json: join(manifest.out, manifest.logs.json)
				}
			: undefined
	};
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
				'To find out what a click, right-click or typing does, open a session (open, then act step by step, then close). ' +
				'Read the logs in each answer before guessing why a screen looks wrong. ' +
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
			.optional()
			.describe(
				'What to look at: "/settings" (web), "app:/talk" (app), "story:button--primary", "preview:Book/Page", "flows/x.yaml" or "flows/*.yaml". Aliases from the config work too. Leave out to run the profile\'s own targets.'
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
		profile: z
			.string()
			.optional()
			.describe(
				'A profile from the config (list what: "profiles"): its devices and variants, and with no targets given, its targets too.'
			),
		browsers: z
			.array(z.enum(['chromium', 'webkit', 'firefox', 'chrome', 'msedge', 'moz-firefox']))
			.optional()
			.describe(
				'Other browsers for web pages, only when asked: "webkit" (Safari\'s engine) and "firefox" (Playwright\'s builds), or the installed "chrome", "msedge", "moz-firefox". Default: Chromium only.'
			),
		steps: z
			.array(z.string())
			.optional()
			.describe(
				'Steps before each screenshot, to reach a menu, dialog or half-filled form: "click:role=button[name=\'Delete\']", "fill:#email=a@b.co", "press:Enter", "wait:role=dialog", "shot:confirm" (a screenshot; without any, one at the end).'
			)
	};
	type TargetsArgs = {
		targets?: string[];
		devices?: string[];
		variants?: string[];
		profile?: string;
		browsers?: string[];
		steps?: string[];
	};
	const requestOf = (args: TargetsArgs): RunRequest => ({
		targets: args.targets ?? [],
		on: args.devices,
		as: args.variants,
		browsers: args.browsers,
		profile: args.profile,
		steps: args.steps?.map(parseStep)
	});

	server.registerTool(
		'capture',
		{
			title: 'Take screenshots',
			description:
				'Takes screenshots of screens on several devices and variants and returns one contact sheet per screen (rows = devices, columns = variants), plus a short summary of failures and problems found.',
			inputSchema: {
				...targetsShape,
				images: z
					.enum(['sheets', 'none'])
					.default('sheets')
					.describe(
						'"sheets": one grid image per screen (default). "none": text and file paths only. To read a detail, use inspect.'
					)
			},
			annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
		},
		async (args, extra) => {
			try {
				const manifest = await execute(requestOf(args), progressOf(extra as never));
				const pictures = args.images === 'none' ? [] : sheets(manifest);
				return {
					content: [{ type: 'text', text: summarize(manifest, { absolute: true }) }, ...pictures],
					structuredContent: runData(manifest)
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
				'Reads screens for problems without taking screenshots: console errors, failed requests, horizontal scrolling, cut-off text, covered buttons, broken images, blank pages, small tap targets (and accessibility with checks=["all"]). Cheapest way to find what to look at.',
			inputSchema: {
				...targetsShape,
				checks: z
					.array(z.string())
					.optional()
					.describe('Which checks; default all but accessibility. "all" adds axe-core.')
			},
			annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
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
				return { content: [{ type: 'text', text }], structuredContent: runData(manifest) };
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
				'Takes the same screenshots again (the last capture, or the targets given) and shows only what changed since the previous run or a saved baseline.',
			inputSchema: {
				targets: targetsShape.targets.optional(),
				devices: targetsShape.devices,
				variants: targetsShape.variants,
				browsers: targetsShape.browsers,
				against: z.string().optional().describe('"previous" (default) or a baseline name.')
			},
			annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
		},
		async (args, extra) => {
			try {
				let request: RunRequest;
				if (args.targets?.length)
					request = {
						targets: args.targets,
						on: args.devices,
						as: args.variants,
						browsers: args.browsers
					};
				else {
					const loaded = await loadConfig({ file: configFile(), cwd: cwd() });
					const file = join(stateDir(loaded.config), 'last-request.json');
					if (!existsSync(file))
						throw new Error('Nothing to repeat yet: capture something first, or give targets.');
					const last = JSON.parse(readFileSync(file, 'utf8')) as RunRequest;
					// The last request again, narrowed or widened by what this call names; never into a folder of its own.
					request = {
						...last,
						out: undefined,
						clean: undefined,
						on: args.devices ?? last.on,
						as: args.variants ?? last.as,
						browsers: args.browsers ?? last.browsers
					};
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
					],
					structuredContent: runData(manifest)
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
				"Returns screenshots from a run at full size (scaled to fit 1568 px) with their problems and log lines. Give a screen, device and variant for one screenshot (and optionally a region of it); leave out device or variant to get that screen's screenshots that failed, have problems or changed (at most 4).",
			inputSchema: {
				screen: z.string().describe('The screen name as the summary shows it.'),
				device: z.string().optional(),
				variant: z.string().optional(),
				run: z.string().optional().describe('A run id; default the latest.'),
				region: z
					.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
					.optional()
					.describe(
						'With device and variant: a part of the screen in CSS pixels/points (multiplied by the device scale for you).'
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
				const id = args.run ?? listRuns(loaded.config)[0];
				if (!id) throw new Error('There are no runs yet.');
				const manifest = readManifest(join(stateDir(loaded.config), 'runs', id));
				if (!manifest) throw new Error(`Run ${id} has no manifest.`);
				const ofScreen = manifest.cells.filter(
					(c) =>
						c.screen === args.screen &&
						(!args.device || c.device === args.device) &&
						(!args.variant || c.variant === args.variant)
				);
				if (!ofScreen.length) {
					throw new Error(
						`No screenshot for ${[args.screen, args.device, args.variant].filter(Boolean).join(' ')} in run ${id}. Screens: ${manifest.screens.map((s) => s.screen).join(', ')}.`
					);
				}
				const single = Boolean(args.device && args.variant);
				const problems = (cell: CellResult) =>
					(cell.findings ?? []).filter((f) => f.severity !== 'info');
				const chosen = single
					? ofScreen
					: ofScreen
							.filter((c) => c.status !== 'ok' || problems(c).length || (c.diff?.ratio ?? 0) > 0)
							.slice(0, 4);
				if (!chosen.length) {
					return {
						content: [
							{
								type: 'text',
								text: `No screenshot of ${args.screen} in run ${id} failed, has a problem or changed. Name a device and variant to see one: ${[...new Set(ofScreen.map((c) => `${c.device}/${c.variant}`))].join(', ')}.`
							}
						]
					};
				}
				const content: Content[] = [];
				for (const cell of chosen) {
					const found = problems(cell);
					content.push({
						type: 'text',
						text:
							`${cell.screen} on ${cell.device}, ${cell.variant} (run ${id}).` +
							(cell.error ? `\nFailed: ${cell.error}` : '') +
							(found.length
								? `\n${found.map((f) => `- ${f.check}: ${f.message}${f.where ? ` — ${f.where}` : ''}`).join('\n')}`
								: '') +
							(cell.notes?.length ? `\n${cell.notes.join('\n')}` : '') +
							cellLog(manifest, `${cell.screen} · ${cell.device} · ${cell.variant}`)
					});
					const rel = args.diff ? cell.diff?.image : cell.image;
					if (!rel) {
						if (args.diff)
							content.push({ type: 'text', text: 'That screenshot has no difference image.' });
						continue;
					}
					let image = readPng(join(manifest.out, rel));
					if (args.region && single) {
						// Pixels per point: the screenshot's width over the device's.
						const device = allDevices(loaded.config)[cell.device];
						const deviceScale = device ? image.width / device.width : 1;
						image = crop(image, {
							x: args.region.x * deviceScale,
							y: args.region.y * deviceScale,
							width: args.region.width * deviceScale,
							height: args.region.height * deviceScale
						});
					}
					content.push({
						type: 'image',
						data: encodePng(fit(image, MAX_SIDE)).toString('base64'),
						mimeType: 'image/png'
					});
				}
				return { content, isError: single && chosen[0].status !== 'ok' ? true : undefined };
			} catch (error) {
				return failure(error);
			}
		}
	);

	server.registerTool(
		'list',
		{
			title: 'What there is',
			description:
				'Lists devices, variants, profiles (named batches: targets × devices × variants), flows (saved step files and their shots), checks, recent runs, or open sessions. Look here for an existing flow or profile before writing a new one.',
			inputSchema: {
				what: z.enum(LISTS).default('devices')
			},
			annotations: { readOnlyHint: true, openWorldHint: false }
		},
		async (args) => {
			try {
				const { config } = await loadConfig({ file: configFile(), cwd: cwd() });
				return { content: [{ type: 'text', text: await listing(args.what, config) }] };
			} catch (error) {
				return failure(error);
			}
		}
	);

	/** A view as text and, unless turned off, the screenshot; the same view as data for clients that read it. */
	const viewAnswer = (view: View) => ({
		content: [
			{ type: 'text', text: describeView(view) },
			...(view.image
				? [
						{
							type: 'image',
							data: encodePng(fit(readPng(view.image), MAX_SIDE)).toString('base64'),
							mimeType: 'image/png'
						}
					]
				: [])
		] as Content[],
		structuredContent: { ...view } as Record<string, unknown>,
		isError: view.failed ? true : undefined
	});
	const lookShape = {
		elements: z
			.boolean()
			.default(true)
			.describe(
				'List what on screen can be acted on, each with a ref ("e12") for the next step. Refs last until the page changes, so every answer lists them afresh.'
			),
		screenshot: z
			.boolean()
			.default(true)
			.describe(
				"Return the screenshot. false answers in text only: cheaper for steps you needn't see."
			),
		tree: z
			.boolean()
			.optional()
			.describe("Also return the page's accessibility tree: all its text and structure, as text."),
		full: z.boolean().optional().describe('Screenshot the whole page, not just the screen.'),
		logLevel: z
			.enum(['debug', 'info', 'warn', 'error'])
			.optional()
			.describe('The least important log lines to return (default info; debug adds every request).')
	};
	type LookArgs = {
		elements: boolean;
		screenshot: boolean;
		tree?: boolean;
		full?: boolean;
		logLevel?: LogLevel;
	};
	const lookOf = (args: LookArgs) => ({
		elements: args.elements,
		picture: args.screenshot,
		tree: args.tree,
		full: args.full,
		logLevel: args.logLevel
	});

	server.registerTool(
		'open',
		{
			title: 'Open a screen',
			description:
				"Opens a screen and keeps it open (a session) on one device and variant, with the project's servers, sign-in and test data: a web page, an Electron or Tauri app's window, or a native Mac app's window. Answers with the session id, a screenshot (CSS pixels for pages, points for Mac windows), what the app and servers logged, and what on screen can be acted on, with refs. Then use act; always close when done.",
			inputSchema: {
				target: z
					.string()
					.describe(
						'"/settings" or a full URL for a web page; "app:/path" for a desktop app\'s screen (with a window device).'
					),
				device: z
					.string()
					.optional()
					.describe('One device, e.g. "phone". Default: the profile\'s first.'),
				variant: z
					.string()
					.optional()
					.describe('One variant, e.g. "dark". Default: the profile\'s first.'),
				browser: z
					.enum(['chromium', 'webkit', 'firefox', 'chrome', 'msedge', 'moz-firefox'])
					.optional()
					.describe('The browser engine (default Chromium); "webkit" is Safari\'s.'),
				...lookShape
			},
			annotations: { readOnlyHint: false, openWorldHint: true }
		},
		async (args) => {
			try {
				const { sessionCall } = await import('../daemon/client.ts');
				const loaded = await loadConfig({ file: configFile(), cwd: cwd() });
				const view = await sessionCall<View>('open', {
					open: {
						target: args.target,
						on: args.browser ? `${args.device ?? 'desktop'}@${args.browser}` : args.device,
						as: args.variant,
						look: lookOf(args)
					},
					configFile: loaded.file,
					cwd: cwd(),
					env: process.env
				});
				opened.add(view.session);
				return viewAnswer(view);
			} catch (error) {
				return failure(error);
			}
		}
	);

	server.registerTool(
		'act',
		{
			title: 'Act on an open screen',
			description:
				'Does steps in an open session, in order, stopping at the first that fails, then answers like open: the screenshot, the log lines since the last answer, console errors and failed requests, and fresh refs. With no steps, just looks again. Name an element by its ref ("e12"), a point on the screenshot ("@x,y"), or a selector ("text=Save", "role=button[name=\'Save\']").',
			inputSchema: {
				session: z.string().describe('The id open returned, e.g. "s-1a2b3c".'),
				steps: z
					.array(z.string())
					.default([])
					.describe(
						'e.g. "click:e3", "rightclick:@420,180", "dblclick:text=Title", "longpress:e5", "hover:e2", "fill:e4=hello", "type:abc", "press:Meta+K", "select:e6=Large", "drag:e7>e9", "scroll:600", "scroll:e10=400", "wait:role=dialog", "goto:/other", "back".'
					),
				...lookShape
			},
			// Steps can do anything a person can, including deleting things on a live site.
			annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
		},
		async (args) => {
			try {
				const { sessionCall } = await import('../daemon/client.ts');
				const view = args.steps.length
					? await sessionCall<View>('act', {
							id: args.session,
							steps: args.steps.map(parseStep),
							options: lookOf(args)
						})
					: await sessionCall<View>('look', { id: args.session, options: lookOf(args) });
				return viewAnswer(view);
			} catch (error) {
				return failure(error);
			}
		}
	);

	server.registerTool(
		'close',
		{
			title: 'Close a screen',
			description:
				'Closes a session. With saveAs, the steps that worked are kept as a flow file that capture can play again on every device.',
			inputSchema: {
				session: z.string(),
				saveAs: z
					.string()
					.optional()
					.describe('A flow file to write, e.g. "flows/delete-account.yaml".')
			},
			annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
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

/** A screenshot's log lines from its run, for inspect. */
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
	// Either way, the sessions this server opened are closed first (within 5 s), so none waits out its idle time.
	const closeSessions = async () => {
		if (!opened.size) return;
		const { sessionCall } = await import('../daemon/client.ts');
		await Promise.race([
			Promise.allSettled([...opened].map((id) => sessionCall('close', { id }))),
			new Promise((done) => setTimeout(done, 5000))
		]);
	};
	for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
		process.once(signal, () => void closeSessions().finally(() => process.exit(0)));
	await new Promise<void>((done) => process.stdin.once('close', done));
	await closeSessions();
}
