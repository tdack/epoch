import { join, resolve } from 'node:path';

const TOOL_DIR = import.meta.dirname;

/**
 * Resolved from this file, not from `process.cwd()`: `npm --prefix tools/setup run` starts the
 * script inside `tools/setup`, and a profile bound there would not be seen by `npm run deploy`.
 */
const REPO_ROOT = resolve(TOOL_DIR, '..', '..');

export interface InstallPaths {
	root: string;
	epochDir: string;
	manifestFile: string;
	logsDir: string;
	deployConfigFile: string;
	trackedConfigFile: string;
	envFile: string;
	spikeDir: string;
	/** `cf`'s binary, from this tool's own dependencies. */
	cfBinary: string;
	/** Wrangler's binary, from the root's dependencies. */
	wranglerBinary: string;
}

export function installPaths(root: string = REPO_ROOT): InstallPaths {
	const epochDir = join(root, '.epoch');
	return {
		root,
		epochDir,
		manifestFile: join(epochDir, 'install.json'),
		logsDir: join(epochDir, 'logs'),
		deployConfigFile: join(root, 'wrangler.deploy.jsonc'),
		trackedConfigFile: join(root, 'wrangler.jsonc'),
		envFile: join(root, '.env'),
		spikeDir: join(epochDir, 'spike'),
		cfBinary: join(TOOL_DIR, 'node_modules', '.bin', 'cf'),
		wranglerBinary: join(root, 'node_modules', '.bin', 'wrangler')
	};
}
