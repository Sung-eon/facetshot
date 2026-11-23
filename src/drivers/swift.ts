/**
 * SwiftUI screens drawn in a test process, no app launched: FacetshotKit (`FacetshotKit/`) renders each scene at each
 * device's size and variant and writes PNGs, and this driver runs that test and collects them.
 *
 * iOS devices render inside an iOS simulator used as a test host (built once with `build-for-testing`, reused while
 * the package's sources don't change); window devices render on this Mac with `swift test`. Neither shows Liquid
 * Glass or presented sheets on iOS — the flow drivers (`app:` targets) are for that.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { Cell, CellResult, Config, Device, Variant } from '../types.ts';
import { ensureBuilt } from '../engine/build.ts';
import { withLock } from '../engine/lock.ts';
import { exec, runToEnd } from '../engine/procs.ts';
import { firstLine, UsageError } from '../errors.ts';
import { slugify } from '../plan.ts';
import { failed, notApplied, type Driver, type RunContext } from './driver.ts';
import { imagePath } from './page.ts';
import { ensureSimulator, simulatorName, useSimulator } from './simctl.ts';

interface IndexEntry {
	scene: string;
	device: string;
	variant: string;
	path: string | null;
	ms: number;
	width?: number;
	height?: number;
	error: string | null;
}

const TEXT_TO_DYNAMIC: Record<string, string> = {
	large: 'accessibility1',
	xlarge: 'accessibility3',
	xxl: 'accessibility5'
};

/** What FacetshotKit reads: the device as it decodes it. */
function deviceJson(device: Device) {
	return {
		name: device.name,
		width: device.split ? Math.round(device.width) : device.width,
		height: device.height,
		scale: device.scale,
		idiom:
			device.idiom ??
			(device.platform === 'window' ? 'mac' : device.width >= 700 ? 'pad' : 'phone'),
		orientation: device.orientation,
		...(device.split ? { horizontalSizeClass: 'compact' } : {}),
		...(device.safeArea ? { safeArea: device.safeArea } : {})
	};
}

function variantJson(variant: Variant) {
	return {
		name: variant.name,
		appearance: variant.appearance ?? 'light',
		...(variant.text && variant.text !== 'default'
			? { dynamicType: TEXT_TO_DYNAMIC[variant.text] }
			: {}),
		...(variant.locale ? { locale: variant.locale } : {}),
		...(variant.direction === 'rtl' ? { layoutDirection: 'rightToLeft' } : {}),
		...(variant.contrast ? { contrast: variant.contrast } : {})
	};
}

export class SwiftSnapshotDriver implements Driver {
	readonly name = 'swift snapshots';
	private derived = '';
	private simulator = '';
	private simulatorName = '';

	handles(cell: Cell, config: Config): boolean {
		return (
			cell.target.kind === 'preview' &&
			(cell.device.platform === 'ios' || cell.device.platform === 'window') &&
			!!config.swift
		);
	}

	private scheme = '';

	private settings(ctx: RunContext) {
		const swift = ctx.config.swift;
		if (!swift)
			throw new UsageError('preview: targets need a `swift` section in facetshot.config.ts.');
		const pkg = resolve(ctx.root, swift.package);
		if (!existsSync(pkg))
			throw new UsageError(`swift.package points at ${pkg}, which doesn't exist.`);
		return { swift, pkg, scheme: swift.scheme ?? this.scheme };
	}

	/**
	 * The scheme Xcode makes for a Swift package: `<name>-Package` when it has several products, the package's own
	 * name when it has one. Asked of xcodebuild rather than guessed.
	 */
	private async findScheme(pkg: string): Promise<string> {
		try {
			const { stdout } = await exec('xcodebuild', ['-list', '-json'], {
				cwd: pkg,
				maxBuffer: 16 * 1024 * 1024
			});
			const listed = JSON.parse(stdout) as { workspace?: { name: string; schemes: string[] } };
			const schemes = listed.workspace?.schemes ?? [];
			return (
				schemes.find((name) => name.endsWith('-Package')) ??
				schemes[0] ??
				`${basename(pkg)}-Package`
			);
		} catch {
			return `${basename(pkg)}-Package`;
		}
	}

	async prepare(cells: Cell[], ctx: RunContext): Promise<void> {
		const { swift, pkg } = this.settings(ctx);
		if (!cells.some((cell) => cell.device.platform === 'ios')) return;
		this.derived = join(ctx.stateDir, 'swift-derived');
		const model =
			cells.find((cell) => cell.device.platform === 'ios')?.device.model ?? 'iPhone 17 Pro Max';
		// Asking xcodebuild for the scheme and finding the simulator are independent, and each takes seconds.
		const [scheme, simulator] = await Promise.all([
			swift.scheme ?? this.findScheme(pkg),
			ensureSimulator(model, ctx)
		]);
		this.scheme = scheme;
		this.simulator = simulator;
		this.simulatorName = simulatorName(model);
		const [target] = swift.test.split('/');
		await ensureBuilt(
			'swift-ios',
			{
				cmd:
					`xcodebuild build-for-testing -quiet -scheme ${JSON.stringify(scheme)} ` +
					`-destination ${JSON.stringify(`platform=iOS Simulator,id=${this.simulator}`)} ` +
					`-derivedDataPath ${JSON.stringify(this.derived)} -only-testing:${target} -jobs 4 ARCHS=arm64 ONLY_ACTIVE_ARCH=YES`,
				cwd: pkg,
				inputs: swift.inputs ?? [swift.package],
				output: join(this.derived, 'Build', 'Products'),
				heavy: true
			},
			{ ...ctx, heavyLock: ctx.locks.build }
		);
	}

	async shoot(cells: Cell[], ctx: RunContext, report: (result: CellResult) => void): Promise<void> {
		const { swift, pkg, scheme } = this.settings(ctx);
		// The simulator and the Mac render at the same time: one waits on a simulator, the other on the build lock.
		await Promise.all(
			(['ios', 'window'] as const).map(async (platform) => {
				const mine = cells.filter((cell) => cell.device.platform === platform);
				if (!mine.length) return;
				const out = join(ctx.runDir, `.swift-${platform}`);
				rmSync(out, { recursive: true, force: true });
				mkdirSync(out, { recursive: true });
				const devices = [...new Map(mine.map((cell) => [cell.device.name, cell.device])).values()];
				const variants = [
					...new Map(mine.map((cell) => [cell.variant.name, cell.variant])).values()
				];
				const env: Record<string, string> = {
					FACETSHOT_OUT: out,
					FACETSHOT_SCENES: [...new Set(mine.map((cell) => cell.target.value))].join(','),
					FACETSHOT_DEVICES: JSON.stringify(devices.map(deviceJson)),
					FACETSHOT_VARIANTS: JSON.stringify(variants.map(variantJson))
				};
				const started = Date.now();
				try {
					if (platform === 'ios') {
						const prefixed = Object.fromEntries(
							Object.entries(env).map(([key, value]) => [`TEST_RUNNER_${key}`, value])
						);
						// Booted for the test and shut down once idle, like the flow driver's simulators (useSimulator).
						await ctx.pools.simulators.run(() =>
							useSimulator(
								this.simulator,
								ctx,
								() =>
									runToEnd(
										{
											cmd:
												`xcodebuild test-without-building -quiet -scheme ${JSON.stringify(scheme)} ` +
												`-destination ${JSON.stringify(`platform=iOS Simulator,id=${this.simulator}`)} ` +
												`-derivedDataPath ${JSON.stringify(this.derived)} -only-testing:${swift.test} ` +
												// In the run's scratch folder, removed with it, so result bundles don't pile up in derived data.
												`-resultBundlePath ${JSON.stringify(join(out, 'result.xcresult'))}`,
											cwd: pkg,
											env: prefixed
										},
										{
											root: ctx.root,
											values: {},
											logFile: join(ctx.stateDir, 'logs', 'swift-ios.log'),
											what: 'The iOS snapshot test',
											signal: ctx.signal
										}
									),
								{ name: this.simulatorName }
							)
						);
					} else {
						const filter = swift.test.split('/').pop();
						// `swift test` builds what changed first, which is a heavy build.
						await withLock(
							ctx.locks.build,
							`facetshot swift test in ${pkg}`,
							() =>
								runToEnd(
									{ cmd: `swift test -j 4 --filter ${JSON.stringify(filter)}`, cwd: pkg, env },
									{
										root: ctx.root,
										values: {},
										logFile: join(ctx.stateDir, 'logs', 'swift-mac.log'),
										what: 'The Mac snapshot test',
										signal: ctx.signal
									}
								),
							{ onWait: ctx.log, signal: ctx.signal, poll: 5000 }
						);
					}
				} catch (error) {
					// The test may still have written screenshots before it failed; collect what is there below.
					if (!existsSync(join(out, 'index.json'))) {
						for (const cell of mine) report(failed(cell, firstLine(error), Date.now() - started));
						return;
					}
				}
				this.collect(mine, out, ctx, report);
			})
		);
	}

	/** Moves FacetshotKit's screenshots into the run's layout and reports one result per scene × device × variant. */
	private collect(
		cells: Cell[],
		out: string,
		ctx: RunContext,
		report: (result: CellResult) => void
	): void {
		const indexFile = join(out, 'index.json');
		if (!existsSync(indexFile)) {
			for (const cell of cells)
				report(failed(cell, `The snapshot test wrote no index.json in ${out}.`));
			return;
		}
		const entries = JSON.parse(readFileSync(indexFile, 'utf8')) as IndexEntry[];
		const wanted = new Set(cells.map((cell) => `${cell.device.name}|${cell.variant.name}`));
		const matched = new Set<string>();
		const byTarget = cells[0];
		for (const entry of entries) {
			if (!wanted.has(`${entry.device}|${entry.variant}`)) continue;
			const cell =
				cells.find(
					(each) => each.device.name === entry.device && each.variant.name === entry.variant
				) ?? byTarget;
			const screen = slugify(entry.scene.replace(/\//g, '.'));
			matched.add(cell.target.raw);
			const base: CellResult = {
				screen,
				target: `preview:${entry.scene}`,
				device: entry.device,
				variant: entry.variant,
				status: entry.path ? 'ok' : 'failed',
				ms: entry.ms,
				error: entry.error ?? undefined,
				notes: [
					...(cell.device.platform === 'ios'
						? [
								'Drawn in a test host: Liquid Glass and blur are flat, sheets and alerts are not shown.'
							]
						: []),
					...notApplied(
						cell.variant,
						['appearance', 'text', 'locale', 'direction', 'contrast'],
						'to a SwiftUI preview'
					)
				]
			};
			if (entry.path) {
				const { file, rel } = imagePath(ctx.runDir, screen, entry.device, entry.variant);
				renameSync(join(out, entry.path), file);
				Object.assign(base, { image: rel, width: entry.width, height: entry.height });
			}
			report(base);
		}
		// A pattern that matched nothing fails once per device and variant, so the sheet shows the gap.
		for (const cell of cells) {
			if (!matched.has(cell.target.raw)) {
				report(
					failed(
						cell,
						`No scene matches "${cell.target.value}". "*" stays within one part of a name ("Book/*"); "**" crosses them.`
					)
				);
			}
		}
		rmSync(out, { recursive: true, force: true });
	}
}
