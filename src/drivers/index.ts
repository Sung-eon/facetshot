/** Every driver, in the order they are asked whether they take a cell. A fresh set per run: drivers keep per-run state. */
import type { Driver } from './driver.ts';
import { ElectronDriver } from './electron.ts';
import { IosSimulatorDriver } from './ios.ts';
import { MacWindowDriver } from './macos.ts';
import { StorybookDriver } from './storybook.ts';
import { SwiftSnapshotDriver } from './swift.ts';
import { TauriDriver } from './tauri.ts';
import { WebDriver } from './web.ts';

export function createDrivers(): Driver[] {
	return [
		new SwiftSnapshotDriver(),
		new StorybookDriver(),
		new ElectronDriver(),
		new TauriDriver(),
		new IosSimulatorDriver(),
		new MacWindowDriver(),
		new WebDriver()
	];
}
