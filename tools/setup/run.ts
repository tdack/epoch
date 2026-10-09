import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CommandError, SetupError, ERROR_CODES } from './errors.ts';
import type { InstallPaths } from './paths.ts';

type Tool = 'cf' | 'wrangler' | 'npm' | 'node';

export interface ExecRequest {
	tool: Tool;
	args: string[];
	/** Added to the child's environment. A value of `undefined` removes the variable. */
	env?: Record<string, string | undefined>;
	stdin?: string;
	/** Inherit the terminal. For `cf auth create`, whose device code and prompts we do not re-render yet. */
	isInteractive?: boolean;
	/** The child prints a credential on stdout (a minted token), so stdout never reaches a log. */
	hasSecretOutput?: boolean;
}

export interface ExecResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

/** The only door to child processes. Tests inject a fake; the real one refuses to run in Vitest. */
export type Exec = (request: ExecRequest) => Promise<ExecResult>;

export interface Redactor {
	/** Register a value that must never appear in a log or on screen. */
	add(secret: string): void;
	redact(text: string): string;
}

const TOKEN_PATTERNS = [/cfut_[A-Za-z0-9_-]{8,}/g, /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/g];
const MIN_SECRET_LENGTH = 8;

export function createRedactor(): Redactor {
	const secrets = new Set<string>();
	return {
		add(secret) {
			if (secret.length >= MIN_SECRET_LENGTH) secrets.add(secret);
		},
		redact(text) {
			let out = text;
			for (const secret of secrets) out = out.split(secret).join('[redacted]');
			for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, '[redacted]');
			return out;
		}
	};
}

interface RealExecOptions {
	paths: InstallPaths;
	logFile: string;
	isVerbose: boolean;
	redactor: Redactor;
}

function binaryFor(tool: Tool, paths: InstallPaths): string {
	if (tool === 'cf') return paths.cfBinary;
	if (tool === 'wrangler') return paths.wranglerBinary;
	if (tool === 'node') return process.execPath;
	return 'npm';
}

/** One-line form of a command for logs and "re-run" hints. Never includes env or stdin. */
export function describeCommand(request: Pick<ExecRequest, 'tool' | 'args'>): string {
	return [request.tool, ...request.args].join(' ');
}

export function createExec(options: RealExecOptions): Exec {
	return (request) => {
		// A test that reaches this would talk to whatever account is logged in on the machine.
		if (process.env.VITEST) {
			throw new Error(
				`Refusing to run "${describeCommand(request)}" under Vitest; inject a fake Exec`
			);
		}
		const { paths, logFile, isVerbose, redactor } = options;
		mkdirSync(dirname(logFile), { recursive: true });
		const log = (text: string) => appendFileSync(logFile, redactor.redact(text));
		log(`\n$ ${describeCommand(request)}\n`);

		return new Promise((resolve, reject) => {
			const env: NodeJS.ProcessEnv = { ...process.env };
			for (const [key, value] of Object.entries(request.env ?? {})) {
				if (value === undefined) delete env[key];
				else env[key] = value;
			}
			// cwd is the repository root so profile bindings and `.env` lookups match `npm run deploy`.
			const child = spawn(binaryFor(request.tool, paths), request.args, {
				cwd: paths.root,
				env,
				// Interactive commands print their own link and code on stdout as well as stderr, so all three are inherited.
				stdio: request.isInteractive ? 'inherit' : ['pipe', 'pipe', 'pipe']
			});
			let stdout = '';
			let stderr = '';
			child.stdout?.on('data', (chunk: Buffer) => {
				stdout += chunk.toString();
			});
			child.stderr?.on('data', (chunk: Buffer) => {
				const text = chunk.toString();
				stderr += text;
				log(text);
				if (isVerbose) process.stderr.write(redactor.redact(text));
			});
			child.on('error', (error) =>
				reject(
					new SetupError(ERROR_CODES.command, `Could not start ${request.tool}: ${error.message}`, {
						hint: 'Run `npm install` at the repository root, then retry.'
					})
				)
			);
			child.on('close', (code) => {
				if (!request.hasSecretOutput) log(`--- stdout\n${stdout}\n`);
				log(`--- exit ${code}\n`);
				resolve({ exitCode: code ?? 1, stdout, stderr });
			});
			if (request.stdin !== undefined) child.stdin?.end(request.stdin);
			else child.stdin?.end();
		});
	};
}

/**
 * One line a person can read, from a failed command's output. Order matters: the specific
 * Cloudflare conditions come before the generic network ones.
 */
export function mapFailure(output: string, command?: string): string {
	const text = output.trim();
	// Permission comes before sign-in: a 403 (code 9109) is a valid login without the right scope, and
	// its text also says "Unauthorized".
	const rules: [RegExp, string][] = [
		[/workers paid|paid plan|upgrade.*plan|requires.*paid/i, 'This needs a Workers Paid plan'],
		[
			/\b403\b|forbidden|\b9109\b|scope|permission/i,
			command
				? `This login lacks the permission for \`${command}\``
				: 'This login lacks a permission this step needs'
		],
		[
			/not logged in|not authenticated|unauthori[sz]ed|\b401\b|expired/i,
			'Not signed in, or the sign-in has expired'
		],
		[
			/rate limit|\b429\b|too many requests/i,
			'Cloudflare is rate limiting this account; wait a minute and retry'
		],
		[/already exists|already taken|name is in use/i, 'A resource with that name already exists'],
		[/ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed|network/i, 'Could not reach Cloudflare']
	];
	for (const [pattern, reason] of rules) if (pattern.test(text)) return reason;
	const firstLine = text.split('\n').find((line) => line.trim().length > 0) ?? 'The command failed';
	return firstLine.trim().slice(0, 160);
}

/**
 * `cf` may print the API envelope (`{ success, result }`) or only the result; whichever it is,
 * steps see the result. Isolated so the spike can settle which one it is.
 */
export function unwrapEnvelope(value: unknown): unknown {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		const record = value as Record<string, unknown>;
		if ('result' in record && ('success' in record || 'errors' in record)) return record.result;
	}
	return value;
}

export interface Runner {
	exec: Exec;
	/** Runs a command, requires exit 0, and returns its JSON result. */
	json(request: ExecRequest): Promise<unknown>;
	/** Runs a command and requires exit 0. */
	text(request: ExecRequest): Promise<string>;
}

export function createRunner(exec: Exec, logPath?: string): Runner {
	async function checked(request: ExecRequest): Promise<ExecResult> {
		const result = await exec(request);
		if (result.exitCode !== 0) {
			throw new CommandError(
				mapFailure(`${result.stderr}\n${result.stdout}`, describeCommand(request)),
				describeCommand(request),
				logPath
			);
		}
		return result;
	}
	return {
		exec,
		async text(request) {
			return (await checked(request)).stdout;
		},
		async json(request) {
			const { stdout } = await checked(request);
			if (stdout.trim() === '') return null;
			try {
				return unwrapEnvelope(JSON.parse(stdout));
			} catch {
				throw new CommandError('The command did not print JSON', describeCommand(request), logPath);
			}
		}
	};
}
