/**
 * What happened while a screen was on: the page's console, its errors, its requests and navigations, and the output
 * of the servers facetshot started. Kept in a bounded book per page, read by position, and written next to the
 * screenshots twice: as JSON lines for programs and agents, and as plain text for people.
 */
import {
	closeSync,
	existsSync,
	openSync,
	readdirSync,
	readSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { ConsoleMessage, Page, Request } from 'playwright';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
	/** Its position in its book: read on from a position with `since`. */
	seq: number;
	/** When, in milliseconds since the epoch. */
	at: number;
	/** `console`, `page`, `network`, `navigation`, `dialog`, or `server:<name>`. */
	source: string;
	level: LogLevel;
	text: string;
}

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function atLeast(entries: LogEntry[], level: LogLevel): LogEntry[] {
	return entries.filter((entry) => RANK[entry.level] >= RANK[level]);
}

/** A page's log. It keeps the last `limit` entries, so a page left open for hours can't grow without end. */
export class LogBook {
	private entries: LogEntry[] = [];
	private next = 1;
	private listeners = new Set<(entry: LogEntry) => void>();
	private taken = 0;

	constructor(private limit = 5000) {}

	/** The position of the last entry. */
	get cursor(): number {
		return this.next - 1;
	}

	add(source: string, level: LogLevel, text: string): void {
		const clean = redact(text);
		const entry: LogEntry = {
			seq: this.next++,
			at: Date.now(),
			source,
			level,
			text: clean.length > 2000 ? `${clean.slice(0, 2000)}…` : clean
		};
		this.entries.push(entry);
		if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
		for (const listener of this.listeners) listener(entry);
	}

	/** Entries after a position. */
	since(cursor: number): LogEntry[] {
		return this.entries.filter((entry) => entry.seq > cursor);
	}

	/** Entries since the last `take`: what belongs to the screenshot just taken. */
	take(): LogEntry[] {
		const out = this.since(this.taken);
		this.taken = this.cursor;
		return out;
	}

	/** Calls `listener` with each new entry until the returned function is called. */
	subscribe(listener: (entry: LogEntry) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}

/**
 * Secrets taken out of a line before it's kept: logs end up in reports, in pull requests and in an agent's context.
 * Tokens, keys, passwords and signatures in query strings and `key: value` pairs, bearer and basic credentials, and
 * anything shaped like a JWT.
 */
export function redact(text: string): string {
	return text
		.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, '$1 …')
		.replace(
			/([?&;\s"']?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|api[_-]?key|apikey|key|secret|client[_-]?secret|password|passwd|pwd|auth|authorization|signature|sig|session|sessionid|code)["']?\s*[=:]\s*["']?)(?!Bearer\b|Basic\b)([^&\s"',;]{4,})/gi,
			'$1…'
		)
		.replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+/g, 'eyJ…');
}

const CONSOLE_LEVELS: Record<string, LogLevel> = {
	error: 'error',
	assert: 'error',
	warning: 'warn',
	debug: 'debug',
	trace: 'debug'
};
/** Requests for these are the page's furniture: kept, but below what a person reads by default. */
const QUIET = new Set(['stylesheet', 'image', 'font', 'media', 'script', 'manifest', 'other']);

export function shortUrl(url: string): string {
	try {
		const parsed = new URL(url);
		return redact(parsed.pathname + parsed.search).slice(0, 160);
	} catch {
		return redact(url).slice(0, 160);
	}
}

function where(message: ConsoleMessage): string {
	const { url, lineNumber } = message.location();
	return url ? ` (${shortUrl(url)}:${lineNumber + 1})` : '';
}

/** Writes what a page does into `book`, for as long as the page lives. */
export function recordPage(page: Page, book: LogBook, blocked: (url: string) => boolean): void {
	page.on('console', (message) =>
		book.add(
			'console',
			CONSOLE_LEVELS[message.type()] ?? 'info',
			`${message.text()}${message.type() === 'error' || message.type() === 'warning' ? where(message) : ''}`
		)
	);
	page.on('pageerror', (error) => {
		const at = error.stack?.split('\n').find((line) => /^\s+at /.test(line));
		book.add('page', 'error', `Uncaught ${error.message}${at ? ` ${at.trim()}` : ''}`);
	});
	page.on('crash', () => book.add('page', 'error', 'The page crashed.'));
	page.on('dialog', (dialog) =>
		book.add('dialog', 'info', `${dialog.type()}: ${dialog.message()}`)
	);
	page.on('framenavigated', (frame) => {
		if (frame === page.mainFrame()) book.add('navigation', 'info', `→ ${frame.url()}`);
	});
	const line = (request: Request, outcome: string) => {
		const timing = request.timing();
		const ms = timing.responseEnd > 0 ? ` ${Math.round(timing.responseEnd)}ms` : '';
		return `${request.method()} ${shortUrl(request.url())} ${outcome}${ms}`;
	};
	page.on('requestfinished', (request) => {
		request.response().then(
			(response) => {
				const status = response?.status() ?? 0;
				const level: LogLevel =
					status >= 500
						? 'error'
						: status >= 400
							? 'warn'
							: QUIET.has(request.resourceType())
								? 'debug'
								: 'info';
				book.add('network', level, line(request, String(status)));
			},
			() => {}
		);
	});
	page.on('requestfailed', (request) => {
		const reason = request.failure()?.errorText ?? 'failed';
		const quiet = blocked(request.url()) || /ERR_ABORTED|cancelled/i.test(reason);
		book.add('network', quiet ? 'debug' : 'error', line(request, `failed: ${reason}`));
	});
}

/** Calls `onLine` with each line a stream writes, as it writes them. */
export function eachLine(
	stream: Readable | null | undefined,
	onLine: (line: string) => void
): void {
	let rest = '';
	stream?.setEncoding('utf8');
	stream?.on('data', (chunk: string) => {
		const lines = (rest + chunk).split('\n');
		rest = lines.pop() ?? '';
		for (const line of lines) if (line.trim()) onLine(line.trimEnd());
	});
}

/** An app's standard output (as `info`) and standard error (as `warn`), into its log, but for lines `skip` matches. */
export function recordOutput(
	child: ChildProcess,
	book: LogBook,
	options: { source?: string; skip?: RegExp } = {}
): void {
	const { source = 'app', skip } = options;
	eachLine(child.stdout, (line) => skip?.test(line) || book.add(source, 'info', line));
	eachLine(child.stderr, (line) => skip?.test(line) || book.add(source, 'warn', line));
}

const OS_LEVELS: Record<string, LogLevel> = {
	Debug: 'debug',
	Info: 'info',
	Default: 'info',
	Error: 'error',
	Fault: 'error'
};

/**
 * What an app writes to the system log (`Logger`, `os_log`, `NSLog`), as it writes it: `log stream` on a Mac, or the
 * same inside a simulator (`command` = `['xcrun', 'simctl', 'spawn', udid, 'log']`). Only lines sent from the app's
 * own bundle (`bundle`, its folder name: `Notes.app`), or with a subsystem that isn't Apple's: the system's frameworks
 * talk a lot in an app's process and rarely about the app. Started before the app, by its process name, so its first
 * lines are kept; `pid`, once known, narrows it to that one process. Returns how to stop it.
 */
export function recordSystemLog(
	processName: string,
	bundle: string,
	book: LogBook,
	options: { command?: string[]; pid?: () => number | undefined } = {}
): () => void {
	const [file, ...args] = options.command ?? ['/usr/bin/log'];
	const predicate =
		`process == ${JSON.stringify(processName)} AND (senderImagePath CONTAINS ${JSON.stringify(`/${bundle}/`)} ` +
		`OR (subsystem CONTAINS "." AND NOT subsystem BEGINSWITH "com.apple."))`;
	const child = spawn(
		file,
		[...args, 'stream', '--style', 'ndjson', '--level', 'info', '--predicate', predicate],
		{ stdio: ['ignore', 'pipe', 'ignore'] }
	);
	child.on('error', () => {});
	eachLine(child.stdout, (line) => {
		let event: {
			eventMessage?: string;
			messageType?: string;
			subsystem?: string;
			category?: string;
			processID?: number;
		};
		try {
			event = JSON.parse(line);
		} catch {
			return; // the header line `log stream` prints first
		}
		const pid = options.pid?.();
		if (!event.eventMessage || (pid && event.processID && event.processID !== pid)) return;
		const source = event.subsystem ? `os_log:${event.category || event.subsystem}` : 'os_log';
		book.add(source, OS_LEVELS[event.messageType ?? ''] ?? 'info', event.eventMessage);
	});
	return () => void child.kill();
}

/**
 * New lines in the server logs facetshot writes (`<state>/logs/*.log`), from where they were when it was made. The
 * lines carry no time of their own; they are stamped when read.
 */
export class LogTail {
	private offsets = new Map<string, number>();

	constructor(private folder: string) {
		for (const name of this.files()) this.offsets.set(name, statSync(join(folder, name)).size);
	}

	private files(): string[] {
		if (!existsSync(this.folder)) return [];
		return readdirSync(this.folder).filter((name) => name.endsWith('.log'));
	}

	/** Adds the new lines to `book`; at most 256 KB per file per read. */
	read(book: LogBook): void {
		for (const name of this.files()) {
			const file = join(this.folder, name);
			const size = statSync(file).size;
			let from = this.offsets.get(name) ?? 0;
			if (size < from) from = 0;
			if (size === from) continue;
			const length = Math.min(size - from, 256 * 1024);
			const buffer = Buffer.alloc(length);
			const fd = openSync(file, 'r');
			try {
				readSync(fd, buffer, 0, length, size - length);
			} finally {
				closeSync(fd);
			}
			this.offsets.set(name, size);
			const source = `server:${name.replace(/\.log$/, '')}`;
			for (const text of buffer.toString('utf8').split('\n')) {
				const clean = text.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();
				if (!clean) continue;
				const level: LogLevel = /\b(error|exception|fatal|fail(ed|ure)?|panic)\b/i.test(clean)
					? 'error'
					: /\bwarn(ing)?\b/i.test(clean)
						? 'warn'
						: 'info';
				book.add(source, level, clean);
			}
		}
	}
}

/** One line for a person: the time (from `origin` when given), the level, where it came from, what it said. */
export function formatEntry(entry: LogEntry, origin?: number | null): string {
	const time =
		origin === null
			? ' '.repeat(9)
			: origin === undefined
				? new Date(entry.at).toISOString().slice(11, 23)
				: `+${((entry.at - origin) / 1000).toFixed(3)}s`.padStart(9);
	return `${time}  ${entry.level.toUpperCase().padEnd(5)}  ${entry.source.padEnd(12)}  ${entry.text}`;
}

export interface LogGroup {
	/** What the entries belong to: a screenshot (`screen · device · variant`), or the servers. */
	label: string;
	started: number;
	entries: LogEntry[];
	/** Lines that carry no time of their own (server output, stamped when read): shown without one. */
	untimed?: boolean;
}

export interface LogSummary {
	/** `logs.txt`, for people. */
	text: string;
	/** `logs.ndjson`, for programs and agents. */
	json: string;
	count: number;
	errors: number;
	warnings: number;
}

/**
 * Writes a run's logs: every entry to `logs.ndjson`, and everything above debug to `logs.txt`, a section per screenshot
 * with times from when it was opened.
 */
export function writeLogs(folder: string, groups: LogGroup[]): LogSummary | undefined {
	const all = groups.flatMap((group) => group.entries.map((entry) => ({ group, entry })));
	if (!all.length) return undefined;
	writeFileSync(
		join(folder, 'logs.ndjson'),
		all
			.map(({ group, entry }) =>
				JSON.stringify({
					at: new Date(entry.at).toISOString(),
					of: group.label,
					source: entry.source,
					level: entry.level,
					text: entry.text
				})
			)
			.join('\n') + '\n'
	);
	const sections = groups
		.map((group) => {
			const shown = atLeast(group.entries, 'info');
			const hidden = group.entries.length - shown.length;
			const lines = shown.map((entry) => formatEntry(entry, group.untimed ? null : group.started));
			if (hidden) lines.push(`           (${hidden} more at debug level in logs.ndjson)`);
			return lines.length ? `== ${group.label}\n${lines.join('\n')}` : '';
		})
		.filter(Boolean);
	writeFileSync(join(folder, 'logs.txt'), `${sections.join('\n\n')}\n`);
	return {
		text: 'logs.txt',
		json: 'logs.ndjson',
		count: all.length,
		errors: all.filter(({ entry }) => entry.level === 'error').length,
		warnings: all.filter(({ entry }) => entry.level === 'warn').length
	};
}
