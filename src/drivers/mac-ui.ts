/**
 * Steps in a Mac app's window, through the system's Accessibility interface (the helper in `mac-helper.swift`):
 * what flows play in native Mac apps and Tauri's real window, and what sessions there are made of.
 *
 * Elements are named as on the web: a ref from the latest list (`e12`), `role=button[name="Save"]`, `text=Save`,
 * `label=Name`, or a point on the screenshot (`@120,80`, in points from the window's top left). A step on an element
 * uses its Accessibility action where it has one (press, show menu), so the pointer is left alone; a point, a drag,
 * a hover and typing are real input, and bring the app to the front.
 */
import { exec, sleep } from '../engine/procs.ts';
import type { Step } from '../flows.ts';
import type { OnScreen } from '../session.ts';
import { helper, windows, type Window } from './macos.ts';

/** One element as the helper reports it: Accessibility's names, screen points. */
export interface AxNode {
	path: string;
	depth: number;
	role: string;
	subrole?: string;
	name: string;
	value?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	disabled?: boolean;
	focused?: boolean;
	selected?: boolean;
	expanded?: boolean;
	actions?: string[];
}

/** A tree as the helpers write it, one JSON object per line (the Mac helper and the iOS runner alike). */
export function parseNodes(text: string): AxNode[] {
	return text
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as AxNode);
}

const WINDOW_BUTTONS: Record<string, string> = {
	AXCloseButton: 'Close',
	AXMinimizeButton: 'Minimize',
	AXZoomButton: 'Zoom',
	AXFullScreenButton: 'Full screen'
};

/** Accessibility roles as the web names them, so `role=button[name="Save"]` means the same thing everywhere. */
const ROLES: Record<string, string> = {
	AXButton: 'button',
	AXMenuButton: 'button',
	AXDisclosureTriangle: 'button',
	AXLink: 'link',
	AXTextField: 'textbox',
	AXTextArea: 'textbox',
	AXComboBox: 'combobox',
	AXPopUpButton: 'combobox',
	AXCheckBox: 'checkbox',
	AXRadioButton: 'radio',
	AXSlider: 'slider',
	AXIncrementor: 'spinbutton',
	AXMenuItem: 'menuitem',
	AXMenuBarItem: 'menuitem',
	AXMenu: 'menu',
	AXStaticText: 'text',
	AXHeading: 'heading',
	AXImage: 'img',
	AXTabGroup: 'tablist',
	AXTable: 'table',
	AXOutline: 'tree',
	AXList: 'list',
	AXRow: 'row',
	AXCell: 'cell',
	AXWindow: 'window',
	AXSheet: 'dialog',
	AXGroup: 'group',
	AXScrollArea: 'group',
	AXWebArea: 'document'
};
const SUBROLES: Record<string, string> = {
	AXSearchField: 'searchbox',
	AXSwitch: 'switch',
	AXTabButton: 'tab',
	AXSecureTextField: 'textbox'
};

export function roleOf(node: Pick<AxNode, 'role' | 'subrole'>): string {
	return (
		(node.subrole && SUBROLES[node.subrole]) ??
		ROLES[node.role] ??
		node.role.replace(/^AX/, '').toLowerCase()
	);
}

/** Roles a person acts on, as on the web; anything with a press or menu action counts too. */
const ACTIONABLE = new Set([
	'button',
	'link',
	'textbox',
	'searchbox',
	'combobox',
	'checkbox',
	'switch',
	'radio',
	'slider',
	'spinbutton',
	'menuitem',
	'tab'
]);

/** The app's window as the helper sees it, with everything in it. */
export interface MacScreen {
	window: Window;
	nodes: AxNode[];
}

/** A Mac app's window, by process: reads it and acts on it. */
export class MacUi {
	/** The elements of the latest list, by ref: what `e12` in the next step means. */
	private refs = new Map<string, AxNode>();

	private constructor(
		private readonly finder: string,
		readonly pid: number
	) {}

	static async of(pid: number, log?: (message: string) => void): Promise<MacUi> {
		return new MacUi(await helper(log), pid);
	}

	private async run(args: string[], timeout = 20_000): Promise<string> {
		try {
			return (await exec(this.finder, [args[0], String(this.pid), ...args.slice(1)], { timeout }))
				.stdout;
		} catch (error) {
			const said = (error as { stderr?: string }).stderr?.trim();
			throw new Error(said || (error as Error).message);
		}
	}

	/** The window a screenshot is of: the largest the app has on screen. */
	async window(): Promise<Window> {
		const window = (await windows(this.finder, this.pid)).at(-1);
		if (!window) throw new Error('The app has no window on screen.');
		return window;
	}

	async screen(): Promise<MacScreen> {
		const [window, text] = await Promise.all([this.window(), this.run(['tree'], 30_000)]);
		return { window, nodes: parseNodes(text) };
	}

	/** What can be acted on, with fresh refs, at points on the window's screenshot. */
	list(screen: MacScreen): OnScreen[] {
		this.refs.clear();
		const { window, nodes } = screen;
		const out: OnScreen[] = [];
		for (const node of nodes) {
			const role = roleOf(node);
			const acts = node.actions?.some((action) =>
				['AXPress', 'AXShowMenu', 'AXConfirm', 'AXPick'].includes(action)
			);
			if (!ACTIONABLE.has(role) && !acts) continue;
			if (role === 'window' || role === 'group' || role === 'document' || role === 'menu') continue;
			if (node.x === undefined || !node.width || !node.height) continue;
			const x = Math.round(node.x - window.x);
			const y = Math.round(node.y! - window.y);
			// Inside the window, or in a menu it opened (a menu can hang over its edge).
			const inMenu = nodes.some(
				(each) => each.role === 'AXMenu' && node.path.startsWith(`${each.path}.`)
			);
			if (
				!inMenu &&
				(x + node.width < 0 || y + node.height! < 0 || x > window.width || y > window.height)
			)
				continue;
			// The window's own buttons have no title, only a kind.
			const name = node.name || WINDOW_BUTTONS[node.subrole ?? ''] || '';
			const ref = `e${out.length + 1}`;
			this.refs.set(ref, node);
			const states = [
				node.disabled && 'disabled',
				node.focused && 'focused',
				node.selected && 'selected',
				node.expanded && 'expanded',
				(role === 'checkbox' || role === 'switch' || role === 'radio') &&
					node.value === '1' &&
					'checked'
			].filter(Boolean) as string[];
			out.push({
				ref,
				role,
				name,
				x,
				y,
				width: Math.round(node.width),
				height: Math.round(node.height!),
				...(states.length ? { states } : {}),
				...(role === 'textbox' || role === 'searchbox' || role === 'combobox'
					? { value: node.value ?? '' }
					: {})
			});
			if (out.length >= 200) break;
		}
		return out;
	}

	/** The window's whole tree as indented text: everything it says, for `--tree`. */
	tree(screen: MacScreen): string {
		return screen.nodes
			.filter((node) => node.name || node.value || ACTIONABLE.has(roleOf(node)))
			.map(
				(node) =>
					`${'  '.repeat(node.depth)}- ${roleOf(node)}${node.name ? ` "${node.name}"` : ''}${node.value ? `: ${node.value}` : ''}`
			)
			.join('\n');
	}

	/** The element a step names, found in the window as it is now. */
	private async find(target: string, timeout = 10_000): Promise<{ node: AxNode; window: Window }> {
		const ref = /^(?:ref=)?(e\d+)$/.exec(target.trim());
		if (ref) {
			const node = this.refs.get(ref[1]);
			if (!node) throw new Error(`${ref[1]} isn't in the latest list; look again for fresh refs.`);
			return { node, window: await this.window() };
		}
		const match = matcher(target);
		const deadline = Date.now() + timeout;
		for (;;) {
			const screen = await this.screen();
			const node = screen.nodes.find(match);
			if (node) return { node, window: screen.window };
			if (Date.now() > deadline) throw new Error(`Nothing in the window matches ${target}.`);
			await sleep(250);
		}
	}

	/** An element's middle as a point on the screen, for real input. */
	private middle(node: AxNode): [number, number] {
		if (node.x === undefined)
			throw new Error(`${roleOf(node)} "${node.name}" has no place on screen.`);
		return [node.x + node.width! / 2, node.y! + node.height! / 2];
	}

	private async action(node: AxNode, action: string): Promise<void> {
		await this.run(['do', node.path, action, node.role, node.name]);
	}

	/** A target as a point on the screen: `@x,y` on the window, or an element's middle. */
	private async point(target: string): Promise<[number, number]> {
		const at = /^@\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(target.trim());
		if (at) {
			const window = await this.window();
			const [x, y] = [Number(at[1]), Number(at[2])];
			// Real input lands on whatever is at that point of the screen: only points on the app's own window.
			if (x < 0 || y < 0 || x > window.width || y > window.height)
				throw new Error(
					`@${x},${y} is outside the window (${window.width}×${window.height} points), so it would reach something else on the screen.`
				);
			return [window.x + x, window.y + y];
		}
		return this.middle((await this.find(target)).node);
	}

	private isPoint(target: string): boolean {
		return target.trim().startsWith('@');
	}

	/** Does one step (anything but `shot` and `goto`, which the driver handles). */
	async step(step: Step): Promise<void> {
		const real = (command: string, ...values: (number | string)[]) =>
			this.run([command, ...values.map(String)]);
		const press = async (target: string, action: 'AXPress' | 'AXShowMenu') => {
			if (!this.isPoint(target)) {
				const { node } = await this.find(target);
				// Some controls list an action they then can't do (SwiftUI's context menus): real input instead.
				if (
					node.actions?.includes(action) &&
					(await this.action(node, action).then(
						() => true,
						() => false
					))
				)
					return;
			}
			const [x, y] = await this.point(target);
			await real('click', x, y, action === 'AXShowMenu' ? 'right' : 'left', 1);
		};
		if ('click' in step) await press(step.click, 'AXPress');
		else if ('tap' in step) await press(step.tap, 'AXPress');
		else if ('rightclick' in step) await press(step.rightclick, 'AXShowMenu');
		else if ('dblclick' in step) {
			const [x, y] = await this.point(step.dblclick);
			await real('click', x, y, 'left', 2);
		} else if ('hover' in step) {
			const [x, y] = await this.point(step.hover);
			await real('move', x, y);
		} else if ('focus' in step) await this.action((await this.find(step.focus)).node, 'focus');
		else if ('drag' in step) {
			const [x1, y1] = await this.point(step.drag);
			const [x2, y2] = await this.point(step.to);
			await real('drag', x1, y1, x2, y2);
		} else if ('fill' in step) {
			// Typed, not set: the app sees the same key presses a person makes, so its own bindings update.
			const { node } = await this.find(step.fill);
			await this.action(node, 'focus');
			await real('key', 'Meta+A');
			if (step.with) await real('type', step.with);
			else await real('key', 'Backspace');
		} else if ('type' in step) await real('type', step.type);
		else if ('press' in step) await real('key', step.press);
		else if ('select' in step) {
			const { node } = await this.find(step.select);
			await this.action(node, 'AXPress');
			const { node: option } = await this.find(
				`role=menuitem[name=${JSON.stringify(step.option)}]`
			);
			await this.action(option, 'AXPress');
		} else if ('scroll' in step) {
			if (typeof step.scroll === 'number') {
				const window = await this.window();
				await real(
					'scroll',
					window.x + window.width / 2,
					window.y + window.height / 2,
					step.scroll
				);
			} else if (step.by !== undefined) {
				const [x, y] = await this.point(step.scroll);
				await real('scroll', x, y, step.by);
			} else {
				const { node } = await this.find(step.scroll);
				if (node.actions?.includes('AXScrollToVisible'))
					await this.action(node, 'AXScrollToVisible');
			}
		} else if ('wait' in step) await this.find(step.wait, 15_000);
		else if ('gone' in step) {
			const match = matcher(step.gone);
			const deadline = Date.now() + 15_000;
			while ((await this.screen()).nodes.some(match)) {
				if (Date.now() > deadline) throw new Error(`${step.gone} is still there after 15 s.`);
				await sleep(250);
			}
		} else if ('menu' in step) await this.run(['menubar', step.menu]);
		else if ('longpress' in step)
			throw new Error(
				'longpress is for touch screens; on a Mac, rightclick opens the menu it would.'
			);
		else if ('back' in step || 'forward' in step || 'reload' in step)
			throw new Error(
				`${Object.keys(step)[0]} is a browser's button; a Mac app has none (use its menu, or goto).`
			);
		else throw new Error(`${JSON.stringify(step)} can't be done in a Mac window.`);
	}

	/** The step as a flow should keep it: a ref becomes its role and name, which a later run can find again. */
	lasting(step: Step): Step {
		const out: Record<string, unknown> = { ...step };
		for (const [key, value] of Object.entries(out)) {
			const ref =
				typeof value === 'string' ? /^(?:ref=)?(e\d+)$/.exec(value.trim())?.[1] : undefined;
			const node = ref ? this.refs.get(ref) : undefined;
			if (!node) continue;
			out[key] = node.name
				? `role=${roleOf(node)}[name=${JSON.stringify(node.name)}]`
				: `role=${roleOf(node)}`;
		}
		return out as Step;
	}
}

/**
 * Which elements a selector means in a Mac window: `role=button`, `role=button[name="Save"]` (`i` after the quote
 * ignores case; without it, too, as on the web for role names), `text=Save` and `label=Name` (the name, ignoring
 * case). CSS and the web's other engines have nothing to match here.
 */
export function matcher(selector: string): (node: AxNode) => boolean {
	const text = selector.trim();
	const byRole = /^role=([\w-]+)(?:\[name=(["'])(.*)\2([is])?\])?$/.exec(text);
	if (byRole) {
		const [, role, , name, flag] = byRole;
		const same =
			flag === 's'
				? (value: string) => value === name
				: (value: string) => value.toLowerCase() === name.toLowerCase();
		return (node) => roleOf(node) === role && (name === undefined || same(node.name));
	}
	const byName = /^(text|label|title)=(["']?)(.*)\2$/.exec(text);
	if (byName) {
		const wanted = byName[3].toLowerCase();
		return (node) =>
			node.name.toLowerCase() === wanted ||
			(byName[1] === 'text' && (node.value ?? '').toLowerCase() === wanted);
	}
	throw new Error(
		`"${selector}" isn't something a Mac window can be searched for: use a ref (e12), role=button[name="Save"], text=Save, label=Name, or a point (@120,80).`
	);
}
