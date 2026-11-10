import { invoke, isTauri } from '@tauri-apps/api/core';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import './styles.css';

const view = document.getElementById('view')!;

/** Two screens, chosen by the path. */
async function render(path: string) {
	for (const link of document.querySelectorAll('nav a')) {
		link.toggleAttribute('aria-current', link.getAttribute('href') === path);
	}
	if (path === '/about') {
		view.innerHTML = `<h1>About</h1><p>Pebble is a tiny inbox for things you want to keep.</p>`;
		return;
	}
	// The greeting comes from the Rust side; in a plain browser facetshot answers it from desktop.invoke.
	const greeting = await invoke<string>('greet', { name: 'Ada' }).catch(() => 'Hello!');
	view.innerHTML = `<h1>Inbox</h1><p class="greeting">${greeting}</p>
		<ul class="items"><li>Receipt from the bike shop</li><li>Train tickets for Friday</li><li>Recipe: lentil soup</li></ul>`;
}

function go(path: string) {
	history.pushState(null, '', path);
	void render(path);
}

document.addEventListener('click', (event) => {
	const link = (event.target as Element).closest('a');
	if (!link || !link.getAttribute('href')?.startsWith('/')) return;
	event.preventDefault();
	go(link.getAttribute('href')!);
});
addEventListener('popstate', () => void render(location.pathname));

// In the app, `pebble://about` arrives here (Tauri's deep-link plugin) and becomes the path `/about`.
if (isTauri()) {
	void onOpenUrl((urls) => {
		const url = new URL(urls[0]);
		go(`/${url.host}${url.pathname}`.replace(/\/+$/, '') || '/');
	}).catch(() => {});
}

void render(location.pathname);
