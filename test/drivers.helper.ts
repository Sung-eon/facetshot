/**
 * Until the new drivers are listed in src/drivers/index.ts, tests that run whole runs register them here. Once they
 * are listed, this does nothing.
 */
import { mock } from 'bun:test';

export async function withAllDrivers(): Promise<void> {
	const index = await import('../src/drivers/index.ts');
	const names = index.createDrivers().map((driver) => driver.name);
	if (names.includes('storybook') && names.includes('electron') && names.includes('tauri')) return;
	const { StorybookDriver } = await import('../src/drivers/storybook.ts');
	const { ElectronDriver } = await import('../src/drivers/electron.ts');
	const { TauriDriver } = await import('../src/drivers/tauri.ts');
	const original = index.createDrivers;
	mock.module('../src/drivers/index.ts', () => ({
		createDrivers: () => {
			const drivers = original();
			// Ahead of the web driver, where the real list puts them.
			const web = drivers.findIndex((driver) => driver.name === 'web');
			const added = [new StorybookDriver(), new ElectronDriver(), new TauriDriver()].filter(
				(driver) => !drivers.some((each) => each.name === driver.name)
			);
			drivers.splice(web < 0 ? drivers.length : web, 0, ...added);
			return drivers;
		}
	}));
}
