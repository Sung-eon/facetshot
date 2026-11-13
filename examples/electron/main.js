// A minimal Electron app: one window showing index.html, whose two views are switched by the URL hash.
import { app, BrowserWindow, Menu, nativeTheme } from 'electron';
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

/** Shows a view in the focused window, as the links in the page do. */
function showView(hash) {
	BrowserWindow.getFocusedWindow()?.webContents.executeJavaScript(
		`location.hash = ${JSON.stringify(hash)}`
	);
}

// The app's own menu: facetshot's `menu:View>Reports` step chooses from it, and its handlers run here in the main
// process. Export writes straight to standard output, the way a native module or a child process would.
const menu = Menu.buildFromTemplate([
	...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
	{
		label: 'File',
		submenu: [
			{
				label: 'Export Report…',
				accelerator: 'CmdOrCtrl+E',
				click: () => process.stdout.write('Exported 3 rows to report.csv\n')
			},
			{ role: 'quit' }
		]
	},
	{
		label: 'View',
		submenu: [
			{ label: 'Today', click: () => showView('#/') },
			{ label: 'Reports', click: () => showView('#/reports') }
		]
	}
]);

app.whenReady().then(() => {
	Menu.setApplicationMenu(menu);
	createWindow();
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
