import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createCloudflareApi } from './cloudflare.ts';
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
	return {
		paths,
		logFile,
		runner,
		cf: createCloudflareApi(runner, {}),
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
