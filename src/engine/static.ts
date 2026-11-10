/**
 * A small static file server for folders facetshot builds itself (a Storybook build, a web frontend's `dist`).
 *
 * It runs inside facetshot's own process rather than as a child command, so it needs nothing installed, works the
 * same on Bun and Node, and goes away with the runtime that owns it. It is deliberately plain: GET and HEAD, the
 * folder's files with their content types, `index.html` for folders, and an optional fallback page for
 * single-page apps.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Running } from './procs.ts';
import { EnvironmentError } from '../errors.ts';

const TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.avif': 'image/avif',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
	'.txt': 'text/plain; charset=utf-8',
	'.wasm': 'application/wasm',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm'
};

export interface StaticOptions {
	/** Served for paths that match no file (a single-page app's `index.html`). Relative to the folder. */
	fallback?: string;
}

/** The file a request path names inside `folder`, or undefined. Never leaves the folder. */
export function resolveStatic(
	folder: string,
	pathname: string,
	options: StaticOptions = {}
): string | undefined {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return undefined;
	}
	const root = resolve(folder);
	const candidate = normalize(join(root, decoded));
	if (candidate !== root && !candidate.startsWith(root + sep)) return undefined;
	const isFile = (path: string) => existsSync(path) && statSync(path).isFile();
	if (isFile(candidate)) return candidate;
	const index = join(candidate, 'index.html');
	if (isFile(index)) return index;
	if (options.fallback) {
		const fallback = join(root, options.fallback);
		if (isFile(fallback)) return fallback;
	}
	return undefined;
}

/** Serves `folder` on a free port of 127.0.0.1 until `stop()` is called. */
export async function serveStatic(
	name: string,
	folder: string,
	options: StaticOptions = {}
): Promise<Running> {
	if (!existsSync(folder) || !statSync(folder).isDirectory()) {
		throw new EnvironmentError(
			`There is no folder to serve for ${name} at ${folder}.`,
			'Check the build step: its `output` must name the folder it writes.'
		);
	}
	const server = createServer((request, response) => {
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			response.writeHead(405).end();
			return;
		}
		const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
		const file = resolveStatic(folder, pathname, options);
		if (!file) {
			response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
			return;
		}
		response.writeHead(200, {
			'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
			'content-length': statSync(file).size,
			// A rebuilt folder must never be served from the browser's cache.
			'cache-control': 'no-store'
		});
		if (request.method === 'HEAD') response.end();
		else createReadStream(file).pipe(response);
	});
	const port = await new Promise<number>((done, fail) => {
		server.once('error', fail);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			done(typeof address === 'object' && address ? address.port : 0);
		});
	});
	// The server must not keep facetshot's own process alive; the runtime stops it.
	server.unref();
	return {
		name,
		url: `http://127.0.0.1:${port}`,
		port,
		owned: true,
		stop: () =>
			new Promise<void>((done) => {
				server.closeAllConnections?.();
				server.close(() => done());
			})
	};
}
