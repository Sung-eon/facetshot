import { expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answers } from '../src/daemon/server.ts';
import { waitUntil } from '../src/engine/procs.ts';

const CLI = join(import.meta.dir, '..', 'src', 'cli.ts');

function daemon(home: string): ChildProcess {
	return spawn(process.execPath, ['--bun', CLI, 'daemon', 'serve'], {
		env: { ...process.env, FACETSHOT_HOME: home },
		stdio: 'ignore'
	});
}

const exited = (child: ChildProcess) =>
	new Promise<number | null>((done) =>
		child.exitCode !== null ? done(child.exitCode) : child.once('exit', done)
	);

test('a second daemon leaves the one that answers alone', async () => {
	const home = mkdtempSync(join(tmpdir(), 'fs-d-'));
	const socket = join(home, 'daemon.sock');
	const first = daemon(home);
	try {
		expect(await waitUntil(() => answers(socket), 15_000)).toBe(true);
		const second = daemon(home);
		expect(await exited(second)).toBe(0);
		expect(await answers(socket)).toBe(true);
		expect(readFileSync(join(home, 'daemon.pid'), 'utf8')).toBe(String(first.pid));
	} finally {
		first.kill('SIGTERM');
		await exited(first);
	}
	expect(existsSync(socket)).toBe(false);
}, 40_000);

test("an old daemon that exits after a new one started doesn't take the new one's socket", async () => {
	const home = mkdtempSync(join(tmpdir(), 'fs-d-'));
	const socket = join(home, 'daemon.sock');
	const old = daemon(home);
	let fresh: ChildProcess | undefined;
	try {
		expect(await waitUntil(() => answers(socket), 15_000)).toBe(true);
		// As when the old one's socket is gone while it is still closing: a new daemon starts on the free path.
		renameSync(socket, `${socket}.old`);
		fresh = daemon(home);
		expect(await waitUntil(() => answers(socket), 15_000)).toBe(true);
		old.kill('SIGTERM');
		await exited(old);
		expect(await answers(socket)).toBe(true);
		expect(readFileSync(join(home, 'daemon.pid'), 'utf8')).toBe(String(fresh.pid));
	} finally {
		old.kill('SIGKILL');
		fresh?.kill('SIGTERM');
		if (fresh) await exited(fresh);
	}
	expect(existsSync(socket)).toBe(false);
}, 40_000);
