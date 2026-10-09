export const ERROR_CODES = {
	missingAnswer: 'missing-answer',
	needsTypedConfirmation: 'needs-typed-confirmation',
	prerequisite: 'prerequisite',
	scopesMissing: 'scopes-missing',
	identityMismatch: 'identity-mismatch',
	environmentToken: 'environment-token',
	foreign: 'foreign-resource',
	command: 'command-failed',
	manifest: 'manifest',
	usage: 'usage',
	cancelled: 'cancelled'
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

interface SetupErrorOptions {
	/** What to do next, shown on its own line under the message. */
	hint?: string;
	/** The flag whose absence caused the error, so a script can find it. */
	flag?: string;
	cause?: unknown;
}

/** A failure the user can act on. Anything else is a bug and prints a stack. */
export class SetupError extends Error {
	readonly code: ErrorCode;
	readonly hint: string | undefined;
	readonly flag: string | undefined;

	constructor(code: ErrorCode, message: string, options: SetupErrorOptions = {}) {
		super(message, { cause: options.cause });
		this.name = 'SetupError';
		this.code = code;
		this.hint = options.hint;
		this.flag = options.flag;
	}
}

/** A `cf`, wrangler or npm child that exited non-zero or printed something unparsable. */
export class CommandError extends SetupError {
	readonly logPath: string | undefined;
	/** The command as the user could re-run it, with secrets redacted. */
	readonly commandLine: string;

	constructor(reason: string, commandLine: string, logPath?: string) {
		super(ERROR_CODES.command, reason, {
			hint: logPath ? `Full output: ${logPath}\nRe-run: ${commandLine}` : `Re-run: ${commandLine}`
		});
		this.name = 'CommandError';
		this.logPath = logPath;
		this.commandLine = commandLine;
	}
}
