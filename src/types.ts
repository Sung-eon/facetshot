/**
 * The shapes everything else in facetshot agrees on: what a project tells it (Config), what it shoots
 * (Target × Device × Variant = Cell), and what it hands back (Manifest).
 */

/** web: a browser viewport. ios: a simulator. window: a desktop app's window (native macOS, Electron or Tauri). */
export type Platform = 'web' | 'ios' | 'window';

/** Where a picture is taken: a browser viewport, a simulator, or a desktop window size. */
export interface Device {
	name: string;
	platform: Platform;
	label?: string;
	/** Logical size in points/CSS pixels. For ios this is the screen in the given orientation. */
	width: number;
	height: number;
	/** Pixel density. */
	scale: number;
	/** web: emulate a phone browser (meta viewport, mobile user agent). */
	mobile?: boolean;
	/** web: touch events. */
	touch?: boolean;
	userAgent?: string;
	/** ios: the simulator device type, as `xcrun simctl list devicetypes` names it. */
	model?: string;
	orientation?: 'portrait' | 'landscape';
	/** ios/macos: the idiom a snapshot renderer should assume. */
	idiom?: 'phone' | 'pad' | 'mac';
	/** ios: run the app in a fraction of the screen width (Split View), e.g. 0.5. */
	split?: number;
	/** Optional safe-area insets for snapshot rendering. */
	safeArea?: { top: number; bottom: number; left: number; right: number };
	/** web: the browser engine, when asked for one (`phone@webkit`); otherwise the config's, or Chromium. */
	browser?: BrowserName;
}

/**
 * Browsers facetshot can take pictures in. Playwright's own builds: `chromium` (the default), `webkit` (Safari's
 * engine) and `firefox`. Browsers installed on the machine: `chrome`, `msedge`, and `moz-firefox` (the Firefox app,
 * driven over WebDriver BiDi, which Playwright supports experimentally).
 */
export type BrowserName = 'chromium' | 'webkit' | 'firefox' | 'chrome' | 'msedge' | 'moz-firefox';
export const BROWSERS: readonly BrowserName[] = [
	'chromium',
	'webkit',
	'firefox',
	'chrome',
	'msedge',
	'moz-firefox'
];

export type TextSize = 'default' | 'large' | 'xlarge' | 'xxl';

/** How a picture is taken: one column of the contact sheet. Each field is one axis; unset means the platform default. */
export interface Variant {
	name: string;
	appearance?: 'light' | 'dark';
	text?: TextSize;
	contrast?: 'more' | 'forced';
	motion?: 'reduce' | 'full';
	locale?: string;
	timezone?: string;
	direction?: 'ltr' | 'rtl';
	/** A persona defined in the project's config (who is signed in). */
	persona?: string;
	network?: 'offline';
	media?: 'print';
}

export type TargetKind = 'web' | 'app' | 'story' | 'preview' | 'flow';

export interface Target {
	kind: TargetKind;
	/** As the person wrote it. */
	raw: string;
	/** web/app: a path such as `/talk`, or a full URL; story/preview: an id or a glob; flow: a file path. */
	value: string;
	/** A short, file-system-safe name used for folders and labels. */
	slug: string;
}

/** One picture to take. */
export interface Cell {
	target: Target;
	device: Device;
	variant: Variant;
	/** The screen this cell belongs to (one contact sheet per screen). Usually the target's slug; a story or preview pattern expands into many screens. */
	screen: string;
	/** For expanded targets (stories, previews): the concrete id. */
	sceneId?: string;
}

export type CellStatus = 'ok' | 'failed' | 'skipped';

export interface Finding {
	check: string;
	severity: 'error' | 'warning' | 'info';
	message: string;
	/** A CSS selector or accessibility path, when there is one. */
	where?: string;
	/** The text involved, shortened. */
	text?: string;
}

export interface CellResult {
	screen: string;
	target: string;
	device: string;
	variant: string;
	status: CellStatus;
	/** Relative to the run folder. */
	image?: string;
	width?: number;
	height?: number;
	ms: number;
	/** Why it failed, written so the reader knows what to do. */
	error?: string;
	/** Readiness gave up and the picture was taken anyway. */
	readyTimedOut?: boolean;
	findings?: Finding[];
	diff?: { against: string; ratio: number; image?: string };
	/** Anything a driver wants the reader to know (e.g. "rendered without Liquid Glass"). */
	notes?: string[];
	/** How much the page logged while it was on screen; the lines are in the run's logs (`Manifest.logs`). */
	log?: { count: number; errors: number; warnings: number };
}

export interface ScreenSheet {
	screen: string;
	/** Relative to the run folder. */
	sheet?: string;
	changed?: boolean;
}

export interface Manifest {
	$schema?: string;
	version: 1;
	runId: string;
	startedAt: string;
	ms: number;
	/** Time spent before the first picture (builds, servers, sign-in, fixtures). */
	prepareMs: number;
	root: string;
	out: string;
	devices: string[];
	variants: string[];
	screens: ScreenSheet[];
	cells: CellResult[];
	/** Failures that are not about one cell (a server would not start, a build failed). */
	errors: string[];
	counts: { ok: number; failed: number; skipped: number; findings: number; changed?: number };
	/**
	 * What the pages and the servers logged during the run, relative to the run folder: `text` for people (a section
	 * per picture), `json` with one entry per line for programs.
	 */
	logs?: { text: string; json: string; count: number; errors: number; warnings: number };
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Configuration                                                                                                      */
/* ------------------------------------------------------------------------------------------------------------------ */

/** A shell command run by facetshot. `{port}` and other placeholders are filled in before it runs. */
export interface Command {
	cmd: string;
	cwd?: string;
	env?: Record<string, string>;
}

/** A command whose result can be reused while its inputs have not changed. */
export interface BuildStep extends Command {
	/** Files and folders (relative to the config) whose contents decide whether a rebuild is needed. */
	inputs: string[];
	/** What the build produces (relative to the config). If it is missing, the build runs again. */
	output?: string;
	/** A heavy build (Xcode, a big bundle): only one runs on this machine at a time, across every checkout and agent. */
	heavy?: boolean;
}

/** A long-running process facetshot starts if it is not already there, and stops when it is done with it. */
export interface Service extends Command {
	/** A fixed port, or `auto` to pick a free one (exposed as `{port}` to the command and `{services.<name>.url}` elsewhere). */
	port?: number | 'auto';
	/** A path (on the service's URL) or a full URL that answers 2xx once the service is ready. */
	health?: string;
	/** If this URL is already healthy, use it and start nothing. */
	reuse?: string;
	/** Milliseconds to wait for health. Default 120 000. */
	startTimeout?: number;
}

export interface ReadyRule {
	/** Quiet network for this long (ms) before shooting. Default 300; 0 skips the network (for pages that poll). */
	idle?: number;
	/** Selectors that must be visible. */
	visible?: string[];
	/** Selectors that must be gone (spinners, skeletons). */
	gone?: string[];
	/** A JavaScript expression that must be truthy, evaluated in the page. */
	when?: string;
	/** Give up and shoot anyway after this long (ms). Default 15 000. */
	timeout?: number;
}

export interface Persona {
	cookies?: { name: string; value: string; domain?: string; path?: string }[];
	headers?: Record<string, string>;
	/** localStorage entries set before any page script runs. */
	storage?: Record<string, string>;
	/** A Playwright storageState file (relative to the config), e.g. saved by a login flow. */
	storageState?: string;
	/** A flow file that signs in; it runs once and its storage state is cached until `ttl` (minutes, default 720) runs out. */
	login?: string;
	ttl?: number;
}

export interface WebConfig {
	/** Where the app is when facetshot does not start it (e.g. a deployed preview or something you run yourself). */
	baseURL?: string;
	/** Built once per change of its inputs; the default is to shoot a production build. */
	build?: BuildStep;
	/** The server that serves the app (preview server, production server, or dev server). */
	serve?: Service;
	browser?: BrowserName;
	personas?: Record<string, Persona>;
	/** The persona used when a variant names none. */
	persona?: string;
	/** localStorage entries for every page (first-run dialogs, cookie banners). */
	storage?: Record<string, string>;
	ready?: ReadyRule & { routes?: Record<string, ReadyRule> };
	/** URL globs to abort (analytics, AI calls, anything with side effects). */
	block?: string[];
	/** URL rewrites, e.g. files served from a fixed host. */
	rewrite?: { from: string; to: string }[];
	/** Selectors painted over in every picture (clocks, avatars with random colors). */
	mask?: string[];
	/** CSS injected into every page. */
	css?: string;
	/** How the `large`/`xlarge`/`xxl` text sizes are made on the web. Default: root font size 125% / 150% / 200%. */
	textSizes?: Partial<Record<Exclude<TextSize, 'default'>, string>>;
	/** Freeze the page clock at this instant (ISO), so "3 minutes ago" stays put. */
	clock?: string;
	/** Fill every picture to the full page height instead of the viewport. Default false. */
	fullPage?: boolean;
}

export interface AppleConfig {
	/** The app's bundle identifier. */
	bundleId: string;
	/** The URL scheme deep links use, e.g. `myapp`. `app:/talk` opens `myapp:///talk`... or `myapp://talk` with `deepLinkStyle: 'host'`. */
	scheme?: string;
	deepLinkStyle?: 'path' | 'host';
	/** A built app (relative to config, or absolute), or a build step that produces one (its `output` is the .app). */
	ios?: { app?: string; build?: BuildStep };
	/** The Mac build of the same app, for `window` devices when there is no `desktop` section. */
	macos?: { app?: string; build?: BuildStep };
	/**
	 * Environment for the launched app (iOS: passed as SIMCTL_CHILD_*). Placeholders are filled. facetshot adds its own:
	 * FACETSHOT_READY_FILE (with `readyFile`), FACETSHOT_SPLIT_WIDTH (a `split` device: the app draws itself that many
	 * points wide, since no simulator command opens Split View), and on a Mac FACETSHOT_WINDOW_SIZE (`<w>x<h>`),
	 * FACETSHOT_APPEARANCE (`light`/`dark`) and FACETSHOT_TEXT (the variant's text size).
	 */
	env?: Record<string, string>;
	/** Launch arguments. */
	args?: string[];
	/** The app writes this file (path given in FACETSHOT_READY_FILE) once a screen has settled; otherwise facetshot waits for the screen to stop changing. */
	readyFile?: boolean;
	/** Environment variables that tell the app which variant to show, for things the simulator cannot switch from outside. */
	variantEnv?: Partial<Record<'appearance' | 'text', Record<string, Record<string, string>>>>;
}

/**
 * A desktop app shown on `window` devices. Exactly one kind per project.
 * - `electron`: launched through Playwright, so it gets everything the web gets (variants, readiness, checks).
 * - `tauri`: on macOS the system web view can't be automated, so the real window is captured (like `macos`);
 *   `frontend` additionally lets the web UI be shot in Playwright's WebKit, the same engine, with full checks.
 * - `macos`: a native Mac app (AppKit/SwiftUI/Catalyst); the window is captured with the system's window capture.
 */
export interface DesktopConfig {
	kind: 'electron' | 'tauri' | 'macos';
	/** electron: the main script or app folder (`.` for package.json main), or a packaged executable. */
	main?: string;
	/** electron: path to the Electron binary if not the project's own `electron` package. */
	executable?: string;
	/** tauri/macos: a built .app (relative to config, or absolute), or a build step that produces one. */
	app?: string;
	build?: BuildStep;
	args?: string[];
	env?: Record<string, string>;
	/**
	 * How an `app:/path` target is reached. electron: a URL loaded in the first window (`{path}` is filled), or
	 * `hash` to set location.hash, or `ipc:<channel>` to send the path to the main process. tauri/macos: a deep link
	 * scheme (`myapp`), opened with `open`.
	 */
	navigate?: string;
	/**
	 * tauri: the web frontend, for shooting the UI in Playwright's WebKit (the engine Tauri uses on macOS) with full
	 * checks. Either `url` (something already running) or a service facetshot starts (`cmd`, e.g. `vite preview
	 * --port {port} --strictPort`), optionally after `build` (e.g. `vite build`).
	 */
	frontend?: Omit<Service, 'cmd'> & { cmd?: string; url?: string; build?: BuildStep };
	/**
	 * tauri: how `app:` targets are shot. `webkit` (the default when `frontend` is set): the frontend in WebKit at
	 * the window's size. `window`: the built app's real window, reached by deep link and captured from the screen
	 * (macOS only).
	 */
	engine?: 'webkit' | 'window';
	/**
	 * tauri, `webkit` engine: answers for `invoke(command)` calls, since there is no Rust backend in the browser.
	 * A command not listed rejects with an error naming it (shown by the console check).
	 */
	invoke?: Record<string, unknown>;
	/** The app writes FACETSHOT_READY_FILE once it has settled (native/tauri), or a page selector/expression (electron, via web.ready). */
	readyFile?: boolean;
}

export interface SwiftSnapshotConfig {
	/** The Swift package or Xcode project folder (relative to config). */
	package: string;
	/** The test to run, `Target/Test` (e.g. `MyAppTests/FacetshotRender`). */
	test: string;
	/** The xcodebuild scheme for iOS runs. Default `<package name>-Package`. */
	scheme?: string;
	/** Input folders whose change triggers a rebuild of the test bundle. Default: the package folder. */
	inputs?: string[];
}

export interface StorybookConfig {
	/** A running Storybook, e.g. http://localhost:6006. */
	url?: string;
	/** A static build: the command and the folder it writes (served by facetshot). */
	build?: BuildStep & { output: string };
	/**
	 * Readiness for stories, laid over Storybook's own "rendered" signal. Default: `web.ready`. `routes` keys are
	 * globs over story ids (`button--*`). A story can add its own with `parameters.facetshot.ready`.
	 */
	ready?: ReadyRule & { routes?: Record<string, ReadyRule> };
	/**
	 * Storybook globals to set per variant, for decorators that switch themes themselves instead of following the
	 * browser's colour scheme. Keys are variant names or values (`dark`, `rtl`, `large`, or `locale` for any
	 * variant with a locale); values are `key:value` pairs joined with `;`, and `{locale}` is the variant's locale.
	 * Example: `{ light: 'theme:light', dark: 'theme:dark', locale: 'locale:{locale}' }`.
	 */
	globals?: Record<string, string>;
}

export interface Limits {
	/** Pages open at once across all web devices. Default 4; inside the daemon, never more than the machine's 4. */
	webPages?: number;
	/** Simulators booted at once. Default 2; inside the daemon, never more than the machine's 2. */
	simulators?: number;
	/** Above this many times the core count (1-minute load average), work goes one at a time. Default 3. */
	maxLoad?: number;
	/** Where machine-wide locks live. Default ~/.facetshot/locks. Point it at an existing lock folder to share locks with other tools. */
	lockDir?: string;
	/** Names of locks in lockDir to use for builds and Mac window captures (e.g. to share a lock your own scripts already take). */
	lockNames?: { build?: string; macWindow?: string };
}

export interface Profile {
	on: string[];
	as: string[];
}

export interface FixtureContext {
	runId: string;
	/** The label to put on everything created, so it can be found and removed later: `facetshot-<runId>`. */
	label: string;
	services: Record<string, { url: string }>;
	/** Record what you made so it can be removed even if this run crashes. */
	record(kind: string, id: string, extra?: Record<string, unknown>): void;
	log(message: string): void;
}

export interface Fixtures {
	/** Creates test data; returns values for `{placeholders}` in targets. */
	setup?(ctx: FixtureContext): Promise<Record<string, string>>;
	/** Removes one recorded item. Called for everything `record` saw, including leftovers from a crashed run. */
	remove?(
		item: { kind: string; id: string; extra?: Record<string, unknown> },
		ctx: FixtureContext
	): Promise<void>;
	/** Keep fixtures between runs while the daemon is up (default true): setup runs once and removal happens when the daemon stops. */
	reuse?: boolean;
}

export interface Config {
	/** The folder the config lives in. Filled in by the loader. */
	root?: string;
	/** Where runs are written (relative to root). Default `.facetshot`. */
	out?: string;
	devices?: Record<string, Partial<Device> & { extends?: string }>;
	/** Named lists of devices, usable anywhere a device is. */
	groups?: Record<string, string[]>;
	variants?: Record<string, Partial<Variant>>;
	/** What `facetshot <targets>` uses when `--on`/`--as` are not given. `default` is used when no `-p` is passed. */
	profiles?: Record<string, Profile>;
	/** Short names for targets: `{ talk: '/talk' }`. */
	aliases?: Record<string, string>;
	services?: Record<string, Service>;
	web?: WebConfig;
	apple?: AppleConfig;
	/** A desktop app for `window` devices: Electron, Tauri, or native macOS. */
	desktop?: DesktopConfig;
	swift?: SwiftSnapshotConfig;
	storybook?: StorybookConfig;
	fixtures?: Fixtures;
	limits?: Limits;
	/** Checks run on every web cell (in addition to `check`). Default: console, network. */
	checks?: string[];
}
