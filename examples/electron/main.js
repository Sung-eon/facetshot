// A minimal Electron app: one window showing index.html, whose two views are switched by the URL hash.
import { app, BrowserWindow, nativeTheme } from 'electron';
import path from 'node:path';

function createWindow() {
	const window = new BrowserWindow({
		width: 1024,
		height: 720,
		title: 'Tally',
		// Follow the system (or facetshot's `nativeTheme.themeSource`) for the window's own background.
		backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#f7f7f8',
		webPreferences: { contextIsolation: true, sandbox: true }
	});
	window.loadFile(path.join(import.meta.dirname, 'index.html'), { hash: '/' });
	// The main process's output shows up in facetshot's logs, next to the window's.
	window.webContents.on('did-navigate-in-page', (_event, url) =>
		console.log(`Showing ${new URL(url).hash || '#/'}`)
	);
}

app.whenReady().then(() => {
	createWindow();
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
