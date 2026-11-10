/** A tiny static server for the test site: `bun serve-static.ts <port>`, serving the current folder. */
const port = Number(process.argv[2] ?? 4173);
Bun.serve({
	port,
	async fetch(request) {
		const path = new URL(request.url).pathname;
		const file = Bun.file(`.${path === '/' ? '/index.html' : path}`);
		return (await file.exists()) ? new Response(file) : new Response('not found', { status: 404 });
	}
});
