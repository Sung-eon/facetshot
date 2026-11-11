/**
 * Errors that end with what to do next. Each kind maps to an exit code, so scripts and agents can tell
 * "your command was wrong" from "this machine is missing something" from "some screenshots failed".
 */

export const EXIT = { ok: 0, someFailed: 1, usage: 2, environment: 3, internal: 4 } as const;

export class FacetshotError extends Error {
	readonly hint?: string;
	readonly exitCode: number;
	constructor(message: string, hint: string | undefined, exitCode: number) {
		super(message);
		this.hint = hint;
		this.exitCode = exitCode;
	}
	/** The message and the hint, as one line each. */
	explain(): string {
		return this.hint ? `${this.message}\n→ ${this.hint}` : this.message;
	}
}

/** The command or config asked for something that doesn't exist or doesn't make sense. */
export class UsageError extends FacetshotError {
	constructor(message: string, hint?: string) {
		super(message, hint, EXIT.usage);
		this.name = 'UsageError';
	}
}

/** Something this machine needs is missing or busy: a browser, Xcode, a port, a permission. */
export class EnvironmentError extends FacetshotError {
	constructor(message: string, hint?: string) {
		super(message, hint, EXIT.environment);
		this.name = 'EnvironmentError';
	}
}

export function explain(error: unknown): string {
	if (error instanceof FacetshotError) return error.explain();
	if (error instanceof Error) return error.message.split('\n')[0];
	return String(error);
}

/** The first line of an error's message: what a screenshot's failure says (the rest is in the logs). */
export function firstLine(error: unknown): string {
	return error instanceof Error ? error.message.split('\n')[0] : String(error);
}
