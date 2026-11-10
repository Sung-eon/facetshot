/**
 * Built-in devices, groups, variants and profiles. A project's config adds to these or overrides them by name.
 *
 * The web sizes are the common breakpoints people design for; the Apple ones are this year's largest phone and
 * tablet, because a layout that fits there and on the small web sizes rarely breaks in between.
 */
import type { Device, Profile, Variant } from './types.ts';

export const DEVICES: Record<string, Device> = {
	// Web
	desktop: {
		name: 'desktop',
		platform: 'web',
		width: 1440,
		height: 900,
		scale: 2,
		label: 'Desktop 1440'
	},
	laptop: {
		name: 'laptop',
		platform: 'web',
		width: 1280,
		height: 800,
		scale: 2,
		label: 'Laptop 1280'
	},
	'tablet-landscape': {
		name: 'tablet-landscape',
		platform: 'web',
		width: 1180,
		height: 820,
		scale: 2,
		touch: true,
		label: 'Tablet landscape'
	},
	'tablet-portrait': {
		name: 'tablet-portrait',
		platform: 'web',
		width: 820,
		height: 1180,
		scale: 2,
		touch: true,
		label: 'Tablet portrait'
	},
	phone: {
		name: 'phone',
		platform: 'web',
		width: 390,
		height: 844,
		scale: 3,
		mobile: true,
		touch: true,
		label: 'Phone 390',
		userAgent:
			'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
	},
	'phone-small': {
		name: 'phone-small',
		platform: 'web',
		width: 360,
		height: 740,
		scale: 3,
		mobile: true,
		touch: true,
		label: 'Phone 360'
	},

	// iOS simulators
	iphone: {
		name: 'iphone',
		platform: 'ios',
		model: 'iPhone 17 Pro Max',
		width: 440,
		height: 956,
		scale: 3,
		idiom: 'phone',
		orientation: 'portrait',
		label: 'iPhone'
	},
	'ipad-portrait': {
		name: 'ipad-portrait',
		platform: 'ios',
		model: 'iPad Pro 13-inch (M5)',
		width: 1032,
		height: 1376,
		scale: 2,
		idiom: 'pad',
		orientation: 'portrait',
		label: 'iPad portrait'
	},
	'ipad-landscape': {
		name: 'ipad-landscape',
		platform: 'ios',
		model: 'iPad Pro 13-inch (M5)',
		width: 1376,
		height: 1032,
		scale: 2,
		idiom: 'pad',
		orientation: 'landscape',
		label: 'iPad landscape'
	},
	'ipad-half': {
		name: 'ipad-half',
		platform: 'ios',
		model: 'iPad Pro 13-inch (M5)',
		width: 688,
		height: 1032,
		scale: 2,
		idiom: 'pad',
		orientation: 'landscape',
		split: 0.5,
		label: 'iPad half'
	},

	// Desktop app windows (native macOS, Electron, Tauri)
	window: {
		name: 'window',
		platform: 'window',
		width: 1280,
		height: 800,
		scale: 2,
		label: 'Window 1280'
	},
	'window-small': {
		name: 'window-small',
		platform: 'window',
		width: 960,
		height: 640,
		scale: 2,
		label: 'Window 960'
	},
	mac: {
		name: 'mac',
		platform: 'window',
		width: 1280,
		height: 800,
		scale: 2,
		idiom: 'mac',
		label: 'Mac'
	},
	'mac-narrow': {
		name: 'mac-narrow',
		platform: 'window',
		width: 1040,
		height: 640,
		scale: 2,
		idiom: 'mac',
		label: 'Mac narrow'
	}
};

export const GROUPS: Record<string, string[]> = {
	/** What a design review looks at on the web: wide, a tablet both ways up, and a phone. */
	web: ['desktop', 'tablet-landscape', 'tablet-portrait', 'phone'],
	ios: ['iphone', 'ipad-portrait', 'ipad-landscape'],
	apple: ['iphone', 'ipad-portrait', 'ipad-landscape', 'ipad-half', 'mac'],
	review: ['desktop', 'tablet-landscape', 'tablet-portrait', 'phone'],
	windows: ['window', 'window-small']
};

export const VARIANTS: Record<string, Variant> = {
	light: { name: 'light', appearance: 'light' },
	dark: { name: 'dark', appearance: 'dark' },
	large: { name: 'large', text: 'large' },
	xlarge: { name: 'xlarge', text: 'xlarge' },
	xxl: { name: 'xxl', text: 'xxl' },
	contrast: { name: 'contrast', contrast: 'more' },
	forced: { name: 'forced', contrast: 'forced' },
	rtl: { name: 'rtl', direction: 'rtl' },
	offline: { name: 'offline', network: 'offline' },
	print: { name: 'print', media: 'print' }
};

/** Named lists of variants, usable anywhere a variant is. */
export const VARIANT_GROUPS: Record<string, string[]> = {
	modes: ['light', 'dark', 'large'],
	a11y: ['light', 'dark', 'xxl', 'contrast']
};

export const PROFILES: Record<string, Profile> = {
	default: { on: ['review'], as: ['light', 'dark'] },
	full: { on: ['review'], as: ['light', 'dark', 'large'] }
};
