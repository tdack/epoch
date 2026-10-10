import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createCloudflareApi, type RawGet, type RawRequest } from './cloudflare.ts';
import { ERROR_CODES, SetupError } from './errors.ts';
import { readEnvToken } from './env-token.ts';
import {
	createCleanup,
	type Cleanup,
	type FileSystem,
	type Reporter,
	type StepContext
} from './context.ts';
import { installPaths, type InstallPaths } from './paths.ts';
import { writeManifest, type Manifest } from './manifest.ts';
import { createExec, createRedactor, createRunner, type Exec } from './run.ts';
import { createWranglerApi } from './wrangler.ts';

const realFileSystem: FileSystem = {
	exists: (path) => existsSync(path),
	read: (path) => readFileSync(path, 'utf8'),
	write: (path, text) => writeFileSync(path, text),
	list: (dir) => (existsSync(dir) ? readdirSync(dir) : [])
};

interface AppOptions {
	reporter: Reporter;
	isVerbose: boolean;
	/** `--plan`, `doctor`: nothing is written under `.epoch` except logs. */
	isReadOnly: boolean;
	root?: string;
	exec?: Exec;
	/** `--deploy-auth`. Ephemeral has no credential for the Workers reads that reconcile needs before deploy. */
	deployAuth?: string;
	/** Sees every raw API read, for the spike to save. */
	onRawResponse?: (path: string, status: number, body: unknown) => void;
}

/** Wires the real world to the steps. Tests build a `StepContext` by hand instead. */
export function createContext(options: AppOptions): StepContext & {
	cleanup: Cleanup & { runAll(): Promise<void> };
	paths: InstallPaths;
	logFile: string;
} {
	const paths = installPaths(options.root);
	const stamp = new Date().toISOString().replaceAll(':', '-');
	const logFile = `${paths.logsDir}/${stamp}.log`;
	const redactor = createRedactor();
	const exec =
		options.exec ?? createExec({ paths, logFile, isVerbose: options.isVerbose, redactor });
	const runner = createRunner(exec, logFile);
	const cleanup = createCleanup();

	// `cf` cannot read a Worker's bindings or set R2 lifecycle rules, so those calls go to the API
	// directly with whichever credential is in use: the environment token, else the wrangler profile's.
	let cachedToken: string | null = null;
	const rawRequest: RawRequest = async (method, path, body) => {
		if (options.deployAuth === 'ephemeral') {
			throw new SetupError(
				ERROR_CODES.usage,
				'--deploy-auth=ephemeral has no credential to read Workers with before the deploy',
				{ flag: '--deploy-auth', hint: 'Use the default, a wrangler profile.' }
			);
		}
		if (cachedToken === null) {
			cachedToken =
				readEnvToken(process.env, realFileSystem, paths.envFile) ??
				(await createWranglerApi(runner, { kind: 'profile', accountId: '' }).getAuthToken());
			redactor.add(cachedToken);
		}
		const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
			method,
			headers: {
				authorization: `Bearer ${cachedToken}`,
				...(body === undefined ? {} : { 'Content-Type': 'application/json' })
			},
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const payload = await response.json().catch(() => null);
		options.onRawResponse?.(path, response.status, payload);
		return { status: response.status, body: payload };
	};
	const rawGet: RawGet = (path) => rawRequest('GET', path);

	return {
		paths,
		logFile,
		runner,
		cf: createCloudflareApi(runner, { rawGet, rawRequest }),
		makeWrangler(auth) {
			if (auth.kind === 'token') redactor.add(auth.token);
			return createWranglerApi(runner, auth);
		},
		cleanup,
		report: options.reporter,
		fs: realFileSystem,
		env: process.env,
		save: (manifest: Manifest) =>
			options.isReadOnly ? manifest : writeManifest(paths.manifestFile, manifest),
		now: () => new Date(),
		fetch: (input, init) => fetch(input, init),
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		nodeVersion: process.versions.node
	};
}
