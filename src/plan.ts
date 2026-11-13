import { Glob } from 'bun';
/**
 * Turns what someone typed (`/talk app:/book --on phone --as dark,large`) into the list of screenshots to take.
 */
import { DEVICES, GROUPS, PROFILES, VARIANTS, VARIANT_GROUPS } from './presets.ts';
import {
	BROWSERS,
	type BrowserName,
	type Cell,
	type Config,
	type Device,
	type Platform,
	type Profile,
	type Target,
	type TargetKind,
	type Variant
} from './types.ts';
import { UsageError } from './errors.ts';
import { loadFlow } from './flows.ts';

/** Which device platforms can show which kind of target. */
const PLATFORMS: Record<TargetKind, Platform[]> = {
	web: ['web'],
	story: ['web'],
	app: ['ios', 'window'],
	preview: ['ios', 'window'],
	flow: ['web', 'ios', 'window']
};

export function slugify(text: string): string {
	const slug = text
		.replace(/^[a-z]+:\/*/i, '')
		.replace(/[?#].*$/, (rest) => rest.replace(/[^\w]+/g, '-'))
		.replace(/[^\p{L}\p{N}._-]+/gu, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
	// A screen's screenshots sit in a folder of its name beside the run's own files, which it must not take.
	return RESERVED.has(slug) ? `${slug}-page` : slug || 'home';
}

const RESERVED = new Set(['report.html', 'manifest.json', 'summary.md', 'latest']);

/** Reads one target. The shape says the kind: `/x` web, `app:/x` app, `story:x` Storybook, `preview:x` SwiftUI, `*.yaml` a flow. */
export function parseTarget(raw: string, config: Config = {}): Target {
	const aliased = config.aliases?.[raw] ?? raw;
	const make = (kind: TargetKind, value: string): Target => ({
		kind,
		raw,
		value,
		slug:
			kind === 'flow'
				? slugify(value.replace(/^.*\//, '').replace(/(\.flow)?\.(ya?ml|json|ts)$/, ''))
				: kind === 'web' || kind === 'app'
					? slugify(value)
					: slugify(value.replace(/\*+/g, 'all'))
	});
	const scheme = config.apple?.scheme;
	if (/^app:/.test(aliased)) return make('app', aliased.slice(4) || '/');
	if (scheme && aliased.startsWith(`${scheme}:`)) return make('app', aliased);
	if (/^story:/.test(aliased)) return make('story', aliased.slice(6));
	if (/^preview:/.test(aliased)) return make('preview', aliased.slice(8));
	if (/^flow:/.test(aliased)) return make('flow', aliased.slice(5));
	if (/\.(ya?ml|json|flow\.ts)$/.test(aliased)) return make('flow', aliased);
	if (/^https?:\/\//.test(aliased) || aliased.startsWith('/')) return make('web', aliased);
	throw new UsageError(
		`I can't tell what "${raw}" is.`,
		'Start web paths with "/" (or a full URL), app screens with "app:", Storybook stories with "story:", SwiftUI previews with "preview:", or give a flow file (.yaml).'
	);
}

/** Fills `{name}` placeholders (fixture ids and the like). Unknown names are left for the caller to report. */
export function fill(text: string, values: Record<string, string>): string {
	return text.replace(/\{([\w.-]+)\}/g, (whole, name: string) => values[name] ?? whole);
}

export function unfilled(text: string): string[] {
	return [...text.matchAll(/\{([\w.-]+)\}/g)].map((match) => match[1]);
}

export function allDevices(config: Config): Record<string, Device> {
	const devices: Record<string, Device> = { ...DEVICES };
	for (const [name, partial] of Object.entries(config.devices ?? {})) {
		const base = partial.extends ? devices[partial.extends] : devices[name];
		if (partial.extends && !base) {
			throw new UsageError(
				`Device "${name}" extends "${partial.extends}", which doesn't exist.`,
				`Known devices: ${Object.keys(devices).join(', ')}.`
			);
		}
		const rest: Partial<Device> = { ...partial };
		delete (rest as { extends?: string }).extends;
		const merged = { ...(base ?? {}), ...rest, name } as Device;
		if (!merged.platform || !merged.width || !merged.height) {
			throw new UsageError(
				`Device "${name}" needs a platform, width and height (or "extends" an existing device).`
			);
		}
		merged.scale ??= 2;
		devices[name] = merged;
	}
	return devices;
}

export function allVariants(config: Config): Record<string, Variant> {
	const variants: Record<string, Variant> = { ...VARIANTS };
	for (const [name, partial] of Object.entries(config.variants ?? {})) {
		variants[name] = { ...(variants[name] ?? {}), ...partial, name };
	}
	return variants;
}

function expand(
	names: string[],
	groups: Record<string, string[]>,
	known: Record<string, unknown>,
	what: string,
	seen = new Set<string>()
): string[] {
	const out: string[] = [];
	for (const raw of names
		.flatMap((name) => name.split(','))
		.map((name) => name.trim())
		.filter(Boolean)) {
		if (groups[raw] && !known[raw]) {
			if (seen.has(raw)) throw new UsageError(`The ${what} group "${raw}" includes itself.`);
			out.push(...expand(groups[raw], groups, known, what, new Set([...seen, raw])));
		} else {
			out.push(raw);
		}
	}
	return [...new Set(out)];
}

/**
 * Device names, groups included. `name@webkit` (or `group@firefox`) is that web device in another browser engine; its
 * name keeps the suffix, so its screenshots sit in their own row.
 */
export function resolveDevices(names: string[], config: Config): Device[] {
	const devices = allDevices(config);
	const groups = { ...GROUPS, ...config.groups };
	const out: Device[] = [];
	for (const raw of names
		.flatMap((name) => name.split(','))
		.map((name) => name.trim())
		.filter(Boolean)) {
		const [base, engine] = raw.split('@') as [string, string | undefined];
		if (engine !== undefined && !BROWSERS.includes(engine as BrowserName)) {
			throw new UsageError(
				`"${engine}" isn't a browser facetshot knows.`,
				`Use one of: ${BROWSERS.join(', ')}.`
			);
		}
		for (const name of expand([base], groups, devices, 'device')) {
			const device = devices[name];
			if (!device) {
				throw new UsageError(
					`There's no device called "${name}".`,
					`Try one of: ${[...Object.keys(groups), ...Object.keys(devices)].join(', ')}. Run "facetshot list devices" to see sizes.`
				);
			}
			if (engine && device.platform !== 'web')
				throw new UsageError(
					`"${raw}": a browser can only be chosen for a web device, and ${name} isn't one.`
				);
			out.push(withBrowser(device, engine as BrowserName | undefined));
		}
	}
	return [...new Map(out.map((device) => [device.name, device])).values()];
}

/** The device in a browser engine; Chromium keeps the plain name, as it's the default. */
export function withBrowser(device: Device, engine: BrowserName | undefined): Device {
	if (!engine || engine === 'chromium') return engine ? { ...device, browser: 'chromium' } : device;
	return { ...device, name: `${device.name}@${engine}`, browser: engine };
}

/** `dark+large` makes one variant out of two. */
export function resolveVariants(names: string[], config: Config): Variant[] {
	const variants = allVariants(config);
	const groups = { ...VARIANT_GROUPS };
	return expand(names, groups, variants, 'variant').map((name) => {
		const parts = name.split('+');
		const merged: Variant = { name };
		for (const part of parts) {
			const variant = variants[part];
			if (!variant) {
				throw new UsageError(
					`There's no variant called "${part}".`,
					`Try one of: ${Object.keys(variants).join(', ')}, or combine them with "+" (dark+large).`
				);
			}
			Object.assign(merged, variant, { name });
		}
		return merged;
	});
}

export interface PlanRequest {
	targets: string[];
	on?: string[];
	as?: string[];
	/** Browser engines for the web devices (default: the config's, or Chromium). */
	browsers?: string[];
	profile?: string;
}

export interface Plan {
	targets: Target[];
	devices: Device[];
	variants: Variant[];
	cells: Cell[];
	/** Targets no requested device can show, with why. */
	unmatched: string[];
}

function profileOf(name: string | undefined, config: Config): Profile {
	const profiles = { ...PROFILES, ...config.profiles };
	const profile = profiles[name ?? 'default'];
	if (!profile) {
		throw new UsageError(
			`There's no profile called "${name}".`,
			`Profiles: ${Object.keys(profiles).join(', ')}.`
		);
	}
	return profile;
}

/** A flow file pattern, `flows/*.yaml`: expanded here, since an MCP client has no shell to do it. */
const FLOW_PATTERN = /[*?{[].*\.(ya?ml|json|flow\.ts)$/;

/**
 * The targets a request names, or else its profile's (a profile with `targets` is a whole batch, run with
 * `-p name`). Flow patterns become the files they match, in order.
 */
export function targetsOf(
	request: Pick<PlanRequest, 'targets' | 'profile'>,
	config: Config
): string[] {
	const named = request.targets.length
		? request.targets
		: (profileOf(request.profile, config).targets ?? []);
	if (!named.length) {
		throw new UsageError(
			'Tell me what to shoot.',
			'For example: facetshot / /settings --on phone, or give a profile with targets: facetshot -p <name>'
		);
	}
	const root = config.root ?? process.cwd();
	return named.flatMap((raw) => {
		const target = config.aliases?.[raw] ?? raw;
		if (!FLOW_PATTERN.test(target)) return [target];
		const files = [...new Glob(target).scanSync({ cwd: root })].sort();
		if (!files.length) throw new UsageError(`No flow files match ${target} (looked in ${root}).`);
		return files;
	});
}

export function plan(request: PlanRequest, config: Config): Plan {
	const profile = profileOf(request.profile, config);
	const targets = targetsOf(request, config).map((raw) => parseTarget(raw, config));
	const onNames = request.on?.length ? request.on : defaultDevices(profile.on, targets, config);
	let devices = resolveDevices(onNames, config);
	// `--browser webkit,firefox`: every web device in each engine asked for (Chromium only if it's among them).
	if (request.browsers?.length) {
		const engines = request.browsers
			.flatMap((each) => each.split(','))
			.map((each) => each.trim())
			.filter(Boolean);
		for (const engine of engines)
			if (!BROWSERS.includes(engine as BrowserName))
				throw new UsageError(
					`"${engine}" isn't a browser facetshot knows.`,
					`Use one of: ${BROWSERS.join(', ')}.`
				);
		devices = devices.flatMap((device) =>
			device.platform !== 'web' || device.browser
				? [device]
				: engines.map((engine) => withBrowser(device, engine as BrowserName))
		);
	}
	const variants = resolveVariants(request.as?.length ? request.as : profile.as, config);

	const cells: Cell[] = [];
	const unmatched: string[] = [];
	for (const target of targets) {
		const kinds = platformsOf(target, config);
		const fits = devices.filter((device) => kinds.includes(device.platform));
		if (!fits.length) {
			unmatched.push(
				`${target.raw}: none of the devices (${devices.map((d) => d.name).join(', ')}) can show a ${target.kind} target. ` +
					`Add ${target.kind === 'web' || target.kind === 'story' ? 'a web device such as "phone"' : 'an Apple device such as "iphone" or "mac"'} with --on.`
			);
			continue;
		}
		for (const device of fits) {
			for (const variant of variants) {
				cells.push({ target, device, variant, screen: target.slug });
			}
		}
	}
	// Only the devices something is shown on: a profile's web devices mean nothing to a run of app screens.
	const used = new Set(cells.map((cell) => cell.device.name));
	const shown = cells.length ? devices.filter((device) => used.has(device.name)) : devices;
	return { targets, devices: shown, variants, cells, unmatched };
}

function platformsOf(target: Target, config: Config): Platform[] {
	return target.kind === 'flow' ? flowPlatforms(target.value, config) : PLATFORMS[target.kind];
}

/**
 * A flow is shown where its start is: an `app:` start on apps; a plain path in a browser, and in the desktop app's
 * window when the config has one (only there, when the config has nothing for the web).
 */
function flowPlatforms(file: string, config: Config): Platform[] {
	try {
		const start = loadFlow(file, config.root ?? process.cwd()).start;
		if (start.startsWith('app:')) return ['ios', 'window'];
		if (!config.desktop) return ['web'];
		return config.web ? ['web', 'window'] : ['window'];
	} catch {
		return PLATFORMS.flow;
	}
}

/** The devices an app screen is shown on when nothing names any: the ones the config can build or launch. */
function appFallback(config: Config): string[] {
	const groups: string[] = [];
	if (config.apple?.ios || !(config.desktop || config.apple?.macos)) groups.push('ios');
	if (config.desktop && config.desktop.kind !== 'macos') groups.push('windows');
	else if (config.desktop || config.apple?.macos) groups.push('mac');
	return groups;
}

/**
 * When no devices are named, the profile decides. A profile made for the web says nothing useful about an app
 * screen (and the other way round), so each target the profile's devices can't show gets the usual ones for its
 * kind: the review devices for the web, and for apps the ones the config can build or launch.
 */
function defaultDevices(profileOn: string[], targets: Target[], config: Config): string[] {
	const covered = new Set(resolveDevices(profileOn, config).map((device) => device.platform));
	const names = [...profileOn];
	for (const target of targets) {
		const platforms = platformsOf(target, config);
		if (platforms.some((platform) => covered.has(platform))) continue;
		const extra = platforms.includes('web') ? ['review'] : appFallback(config);
		for (const name of extra) if (!names.includes(name)) names.push(name);
		for (const device of resolveDevices(extra, config)) covered.add(device.platform);
	}
	return names;
}
