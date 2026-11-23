/**
 * `facetshot doctor`: checks what this machine and project need, and says how to fix each thing that is missing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { expandHome, homeFolder, loadConfig } from './config.ts';
import { EXIT, explain } from './errors.ts';
import { exec, portBusy } from './engine/procs.ts';
import { helper } from './drivers/macos.ts';
import { VERSION } from './version.ts';
import { setupCommand } from './setup.ts';

interface Line {
	/** `info`: neither good nor bad, just so (an optional browser that isn't here). */
	ok: boolean | 'warn' | 'info';
	what: string;
	fix?: string;
}

function has(command: string, args: string[] = ['--version']): string | undefined {
	try {
		return execFileSync(command, args, {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
			timeout: 15_000
		})
			.trim()
			.split('\n')[0];
	} catch {
		return undefined;
	}
}

/**
 * Who listens on a port: the command and pid (from lsof), whether facetshot's background helper started it (the pid
 * or one of its parents is the helper's), and then for which project (the open project whose root holds the
 * process's working folder). Undefined when lsof can't say (not installed, or another user's process).
 */
export async function portHolder(
	port: number
): Promise<{ command: string; pid: number; helper: boolean; project?: string } | undefined> {
	const fields = async (args: string[]) =>
		(
			await exec('lsof', args).catch((error: { stdout?: string }) => ({
				stdout: error.stdout ?? ''
			}))
		).stdout
			.split('\n')
			.filter(Boolean);
	const listing = await fields(['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc']);
	const pid = Number(listing.find((line) => line.startsWith('p'))?.slice(1));
	const command = listing.find((line) => line.startsWith('c'))?.slice(1);
	if (!pid || !command) return undefined;
	const { status } = await import('./daemon/client.ts');
	const daemon = await status();
	let helper = false;
	for (let each = pid, depth = 0; daemon && each > 1 && depth < 20; depth++) {
		if (each === daemon.pid) {
			helper = true;
			break;
		}
		each = Number(
			(
				await exec('ps', ['-o', 'ppid=', '-p', String(each)]).catch(() => ({ stdout: '' }))
			).stdout.trim()
		);
	}
	if (!helper || !daemon) return { command, pid, helper };
	const cwd = (await fields(['-a', '-p', String(pid), '-d', 'cwd', '-Fn']))
		.find((line) => line.startsWith('n'))
		?.slice(1);
	const project = daemon.projects
		.map((each) => each.root)
		.filter((root) => cwd && (cwd === root || cwd.startsWith(root + sep)))
		.sort((a, b) => b.length - a.length)[0];
	return { command, pid, helper, project };
}

export async function doctor(options: { configFile?: string }): Promise<number> {
	const lines: Line[] = [];
	const runtime = process.versions.bun
		? `Bun ${process.versions.bun}`
		: `Node ${process.versions.node}`;
	lines.push({ ok: true, what: `facetshot ${VERSION} on ${runtime}, ${process.platform}` });

	let loaded: Awaited<ReturnType<typeof loadConfig>> | undefined;
	try {
		loaded = await loadConfig({ file: options.configFile });
		lines.push(
			loaded.file
				? { ok: true, what: `Config: ${loaded.file}` }
				: {
						ok: 'warn',
						what: 'No facetshot.config.ts found (full URLs still work).',
						fix: 'facetshot init'
					}
		);
	} catch (error) {
		lines.push({ ok: false, what: `Config doesn't load: ${explain(error)}` });
	}
	const config = loaded?.config;

	// The browser.
	try {
		const { chromium } = await import('playwright');
		const browser = await chromium.launch({ headless: true });
		await browser.close();
		lines.push({ ok: true, what: 'Playwright Chromium starts' });
	} catch (error) {
		lines.push({
			ok: false,
			what: `Playwright Chromium doesn't start: ${explain(error)}`,
			fix: setupCommand()
		});
	}
	// The other browsers, used only when asked (--browser): which ones this machine can start.
	const { Runtime } = await import('./engine/runtime.ts');
	const { BROWSERS } = await import('./types.ts');
	const others = BROWSERS.filter((name) => name !== 'chromium');
	const results = await Promise.all(
		others.map(async (name) => {
			const runtime = new Runtime();
			try {
				await runtime.browser(name);
				return { name, ok: true as const };
			} catch (error) {
				return { name, ok: false as const, why: explain(error) };
			} finally {
				await runtime.close();
			}
		})
	);
	const ready = results.filter((each) => each.ok).map((each) => each.name);
	lines.push({
		ok: true,
		what: `Other browsers, on request (--browser): ${ready.length ? ready.join(', ') : 'none yet'}`
	});
	for (const each of results) {
		if (each.ok) continue;
		// Only a browser the config makes the default is a problem; the rest are just not available.
		const needed = config?.web?.browser === each.name;
		lines.push({
			ok: needed ? false : 'info',
			what: `${each.name} not available: ${each.why.split('\n')[0]}`,
			fix: ['webkit', 'firefox'].includes(each.name) ? setupCommand(each.name) : undefined
		});
	}

	// Ports the config asks for.
	const ports: [string, number][] = [];
	for (const [name, service] of Object.entries(config?.services ?? {}))
		if (typeof service.port === 'number') ports.push([name, service.port]);
	if (typeof config?.web?.serve?.port === 'number') ports.push(['web', config.web.serve.port]);
	for (const [name, port] of ports) {
		if (!(await portBusy(port))) {
			lines.push({ ok: true, what: `Port ${port} (${name}) is free` });
			continue;
		}
		const holder = await portHolder(port);
		const who = holder ? `${holder.command} (pid ${holder.pid})` : "a process facetshot can't see";
		if (holder?.helper && holder.project === loaded?.root)
			lines.push({
				ok: 'info',
				what: `Port ${port} (${name}) is held by ${who}, which facetshot's background helper started for this project`
			});
		else if (holder?.helper)
			lines.push({
				ok: 'warn',
				what: `Port ${port} (${name}) is held by ${who}, which facetshot's background helper started for ${holder.project ?? 'another project'}.`,
				fix: "Give this project's service another port (or port: 'auto'), or stop that project's session or run."
			});
		else
			lines.push({
				ok: 'warn',
				what: `Port ${port} (${name}) is in use by ${who}, which facetshot didn't start.`,
				fix: holder
					? `Stop it, or give the service another port (or port: 'auto').`
					: `lsof -nP -iTCP:${port} -sTCP:LISTEN`
			});
	}

	// Apple tools, when the project uses them.
	if (
		process.platform === 'darwin' &&
		(config?.apple ||
			config?.swift ||
			config?.desktop?.kind === 'macos' ||
			config?.desktop?.kind === 'tauri')
	) {
		const xcode = has('xcodebuild', ['-version']);
		lines.push(
			xcode
				? { ok: true, what: xcode }
				: {
						ok: false,
						what: 'Xcode is not installed or not selected.',
						fix: 'xcode-select -s /Applications/Xcode.app'
					}
		);
		const runtimes = has('xcrun', ['simctl', 'list', 'runtimes']);
		lines.push(
			runtimes?.includes('iOS') ||
				(runtimes && has('xcrun', ['simctl', 'list', 'runtimes', '-j'])?.includes('iOS'))
				? { ok: true, what: 'An iOS simulator runtime is installed' }
				: {
						ok: 'warn',
						what: 'No iOS simulator runtime found.',
						fix: 'Xcode → Settings → Components → iOS'
					}
		);
		if (config?.desktop?.kind === 'macos' || config?.desktop?.kind === 'tauri' || config?.apple) {
			// Both are granted to the app facetshot runs in (the terminal, or the agent's app), and asked of the helper.
			const finder = await helper().catch(() => undefined);
			const asks = async (command: string) =>
				finder ? (await exec(finder, [command]).catch(() => ({ stdout: '' }))).stdout.trim() : '';
			lines.push(
				(await asks('check')) === 'granted'
					? { ok: true, what: 'Screen Recording is allowed (screenshots of Mac windows)' }
					: {
							ok: 'warn',
							what: 'Screenshots of Mac windows need Screen Recording for the app running facetshot.',
							fix: 'System Settings → Privacy & Security → Screen & System Audio Recording → allow your terminal or agent app, then restart it'
						},
				(await asks('trusted')) === 'granted'
					? { ok: true, what: 'Accessibility is allowed (steps and sessions in Mac windows)' }
					: {
							ok: 'warn',
							what: "Steps and sessions in Mac windows (pressing, typing, menus) need Accessibility for the app running facetshot. Screenshots alone don't.",
							fix: "System Settings → Privacy & Security → Accessibility → allow your terminal or agent app (restart it if facetshot still can't)"
						}
			);
		}
	}
	if (config?.desktop?.kind === 'electron') {
		lines.push(
			existsSync(join(loaded!.root, 'node_modules', 'electron'))
				? { ok: true, what: 'Electron is installed in the project' }
				: { ok: false, what: 'Electron is not installed in the project.', fix: 'npm i -D electron' }
		);
	}

	// Locks and the daemon.
	const lockDir = expandHome(config?.limits?.lockDir ?? join(homeFolder(), 'locks'));
	if (existsSync(lockDir)) {
		for (const name of readdirSync(lockDir).filter((each) => each.endsWith('.lock'))) {
			const note = join(lockDir, name, 'owner.json');
			const owner = existsSync(note)
				? (JSON.parse(readFileSync(note, 'utf8')) as { what: string; pid: number; since: string })
				: undefined;
			lines.push({
				ok: 'warn',
				what: `Lock ${name} is held${owner ? ` by ${owner.what} (pid ${owner.pid}) since ${owner.since}` : ' (by a script)'}; builds will wait for it.`,
				fix: owner ? undefined : `If nothing is building, remove it: rmdir ${join(lockDir, name)}`
			});
		}
	}
	const { status } = await import('./daemon/client.ts');
	const daemon = await status();
	lines.push({
		ok: true,
		what: daemon
			? `Daemon running (pid ${daemon.pid}, ${daemon.active} run(s) now)`
			: 'Daemon not running (it starts by itself)'
	});

	for (const line of lines) {
		process.stdout.write(
			`${line.ok === true ? '✓' : line.ok === 'warn' ? '!' : line.ok === 'info' ? '·' : '✗'} ${line.what}\n${line.fix ? `  → ${line.fix}\n` : ''}`
		);
	}
	return lines.some((line) => line.ok === false) ? EXIT.environment : EXIT.ok;
}
