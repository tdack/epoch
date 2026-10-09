// tools/setup has its own package.json (the setup CLI's dependencies stay out of the production
// build), and a root `npm ci` does not install them. Lint, check, test and `npm run setup` all need
// them, so each runs this first through an npm `pre` hook. It is a no-op when they are current.
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const toolDir = join(import.meta.dirname, '..', 'tools', 'setup');
const lock = join(toolDir, 'package-lock.json');
const installed = join(toolDir, 'node_modules', '.package-lock.json');

const isCurrent = existsSync(installed) && statSync(installed).mtimeMs >= statSync(lock).mtimeMs;
if (!isCurrent) {
	console.error('Installing the setup tool’s dependencies (tools/setup)…');
	const result = spawnSync(
		'npm',
		['ci', '--prefix', toolDir, '--no-audit', '--no-fund', '--loglevel=error'],
		{
			stdio: 'inherit'
		}
	);
	process.exit(result.status ?? 1);
}
