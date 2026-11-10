/**
 * `facetshot doctor`: checks what this machine and project need, and says how to fix each thing that is missing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expandHome, homeFolder, loadConfig } from './config.ts';
import { EXIT, explain } from './errors.ts';
import { portBusy } from './engine/procs.ts';
import { VERSION } from './version.ts';

interface Line {
	ok: boolean | 'warn';
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
			fix: 'npx playwright install chromium'
		});
	}
	if (config?.web?.browser && config.web.browser !== 'chromium') {
		try {
			const playwright = await import('playwright');
			const browser = await playwright[config.web.browser].launch({ headless: true });
			await browser.close();
			lines.push({ ok: true, what: `Playwright ${config.web.browser} starts` });
		} catch {
			lines.push({
				ok: false,
				what: `Playwright ${config.web.browser} isn't installed`,
				fix: `npx playwright install ${config.web.browser}`
			});
		}
	}

	// Ports the config asks for.
	const ports: [string, number][] = [];
	for (const [name, service] of Object.entries(config?.services ?? {}))
		if (typeof service.port === 'number') ports.push([name, service.port]);
	if (typeof config?.web?.serve?.port === 'number') ports.push(['web', config.web.serve.port]);
	for (const [name, port] of ports) {
		const busy = await portBusy(port);
		lines.push(
			busy
				? {
						ok: 'warn',
						what: `Port ${port} (${name}) is in use — fine if it's facetshot's own server from an earlier run.`,
						fix: `lsof -nP -iTCP:${port} -sTCP:LISTEN`
					}
				: { ok: true, what: `Port ${port} (${name}) is free` }
		);
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
			lines.push({
				ok: 'warn',
				what: 'Mac window pictures need Screen Recording permission for the app running facetshot.',
				fix: 'System Settings → Privacy & Security → Screen & System Audio Recording → allow your terminal or agent app'
			});
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
			`${line.ok === true ? '✓' : line.ok === 'warn' ? '!' : '✗'} ${line.what}\n${line.fix ? `  → ${line.fix}\n` : ''}`
		);
	}
	return lines.some((line) => line.ok === false) ? EXIT.environment : EXIT.ok;
}
