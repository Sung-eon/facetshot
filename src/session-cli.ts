/** `facetshot open | act | look | close | logs`: sessions and logs from the command line. */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from './config.ts';
import { EXIT, UsageError } from './errors.ts';
import { parseStep } from './flows.ts';
import { atLeast, formatEntry, type LogEntry, type LogLevel } from './logs.ts';
import { listRuns, stateDir } from './run.ts';
import { describeView, type LookOptions, type View } from './session.ts';
import { sessionCall, sessionLogs } from './daemon/client.ts';

type Flags = Record<string, string | true>;

/** `--on phone --browser webkit` is `phone@webkit`; a browser alone is the default device in it. */
function withEngine(on: string | undefined, browser: string | undefined): string | undefined {
	if (!browser) return on;
	if (!on)
		throw new UsageError(
			'--browser in a session needs a device too: facetshot open /x --on phone --browser webkit'
		);
	return `${on}@${browser}`;
}
const LEVELS = ['debug', 'info', 'warn', 'error'];

function level(flags: Flags, fallback: LogLevel): LogLevel {
	const value = typeof flags.level === 'string' ? flags.level : fallback;
	if (!LEVELS.includes(value)) throw new UsageError(`--level is one of ${LEVELS.join(', ')}.`);
	return value as LogLevel;
}

function show(view: View, flags: Flags): number {
	process.stdout.write(flags.json ? `${JSON.stringify(view, null, 2)}\n` : describeView(view));
	return view.failed ? EXIT.someFailed : EXIT.ok;
}

export async function sessionCommand(
	command: string,
	positional: string[],
	flags: Flags
): Promise<number> {
	const options: LookOptions = {
		elements: flags['no-elements'] !== true,
		picture: flags['no-screenshot'] !== true,
		tree: flags.tree === true,
		full: flags.full === true,
		logLevel: level(flags, 'info')
	};
	const id = positional[0];
	const needId = () => {
		if (!id)
			throw new UsageError(
				`facetshot ${command} needs a session id (facetshot list sessions shows them).`
			);
		return id;
	};
	switch (command) {
		case 'open': {
			if (positional.length !== 1)
				throw new UsageError(
					'facetshot open takes one target: facetshot open /settings --on phone'
				);
			const one = (value: string | true | undefined, flag: string) => {
				if (typeof value !== 'string') return undefined;
				if (value.includes(','))
					throw new UsageError(
						`A session is one device and one variant: --${flag} ${value.split(',')[0]}.`
					);
				return value;
			};
			const view = await sessionCall<View>('open', {
				open: {
					target: positional[0],
					on: withEngine(one(flags.on, 'on'), one(flags.browser, 'browser')),
					as: one(flags.as, 'as'),
					look: options
				},
				configFile: typeof flags.config === 'string' ? flags.config : undefined,
				cwd: process.cwd(),
				env: process.env
			});
			return show(view, flags);
		}
		case 'act': {
			const steps = positional.slice(1).map(parseStep);
			if (!steps.length)
				throw new UsageError('facetshot act needs a step: facetshot act s-1a2b3c click:#3');
			return show(await sessionCall<View>('act', { id: needId(), steps, options }), flags);
		}
		case 'look':
			return show(await sessionCall<View>('look', { id: needId(), options }), flags);
		case 'close': {
			const answer = await sessionCall<{ closed: string; saved?: string }>('close', {
				id: needId(),
				save: typeof flags.save === 'string' ? resolve(flags.save) : undefined
			});
			process.stdout.write(
				`Closed ${answer.closed}.${answer.saved ? ` Its steps are in ${answer.saved}; play them again with facetshot ${answer.saved}` : ''}\n`
			);
			return EXIT.ok;
		}
		case 'logs':
			return logsCommand(needId(), flags);
		default:
			throw new UsageError(`Unknown command "${command}".`);
	}
}

/** A session's logs (live with --follow), or a run's (by id, `latest`, or its folder). */
async function logsCommand(id: string, flags: Flags): Promise<number> {
	const least = level(flags, 'info');
	if (/^s-[0-9a-f]+$/.test(id)) {
		await sessionLogs(id, {
			follow: flags.follow === true,
			onEntry: (entry: LogEntry) => {
				if (!atLeast([entry], least).length) return;
				process.stdout.write(flags.json ? `${JSON.stringify(entry)}\n` : `${formatEntry(entry)}\n`);
			}
		});
		return EXIT.ok;
	}
	if (flags.follow) throw new UsageError("--follow is for sessions; a run's logs are finished.");
	const { config } = await loadConfig({
		file: typeof flags.config === 'string' ? flags.config : undefined
	});
	const state = stateDir(config);
	const folder = [
		id === 'latest' ? join(state, 'runs', listRuns(config)[0] ?? '-') : join(state, 'runs', id),
		resolve(id)
	].find((each) => existsSync(join(each, 'logs.ndjson')));
	if (!folder)
		throw new UsageError(
			`No logs for "${id}".`,
			'Give a session id, a run id, latest, or a run folder.'
		);
	const lines = readFileSync(join(folder, 'logs.ndjson'), 'utf8').split('\n').filter(Boolean);
	let group = '';
	for (const line of lines) {
		const entry = JSON.parse(line) as {
			at: string;
			of: string;
			source: string;
			level: LogLevel;
			text: string;
		};
		if (!atLeast([{ ...entry, seq: 0, at: 0 }], least).length) continue;
		if (flags.json) {
			process.stdout.write(`${line}\n`);
			continue;
		}
		if (entry.of !== group) {
			group = entry.of;
			process.stdout.write(`\n== ${group}\n`);
		}
		process.stdout.write(
			`${formatEntry({ ...entry, seq: 0, at: Date.parse(entry.at) }, entry.of === 'servers' ? null : undefined)}\n`
		);
	}
	return EXIT.ok;
}
