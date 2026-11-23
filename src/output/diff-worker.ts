/** Runs image comparisons off the main thread (see diffImages in diff.ts). */
import { compareImages, type DiffJob } from './diff.ts';

declare const self: Worker;

self.onmessage = (event: MessageEvent<{ id: number; job: DiffJob }>) => {
	const { id, job } = event.data;
	try {
		self.postMessage({ id, result: compareImages(job) });
	} catch (error) {
		self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
	}
};
