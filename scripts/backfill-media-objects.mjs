// Gives every media file written before migration 0055 an object of its own (ADR-082, migration
// step 3): the object takes the file's id, version, timestamps and uploader, then the file's
// object_id is set. Run after the code that writes objects is deployed, and again once that deploy
// has fully rolled out, to catch a file the old code inserted meanwhile:
//
//   node scripts/backfill-media-objects.mjs            # local database
//   node scripts/backfill-media-objects.mjs --remote   # deployed database
//
// It is idempotent: only files with no object_id are touched, and an object that already exists is
// not created twice. The SQL is bundled from the app's own source so the test and the script agree.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { DEPLOY_CONFIG, requireDeployConfig } from './deploy-config.mjs';

const isRemote = process.argv.includes('--remote');
const target = isRemote ? '--remote' : '--local';
if (isRemote) requireDeployConfig();
const configArgs = isRemote ? ['-c', DEPLOY_CONFIG] : [];
const dir = mkdtempSync(join(tmpdir(), 'epoch-backfill-media-objects-'));

try {
	const bundle = join(dir, 'media-backfill.mjs');
	await build({
		entryPoints: [
			new URL('../src/lib/server/repositories/media-backfill.ts', import.meta.url).pathname
		],
		outfile: bundle,
		bundle: true,
		format: 'esm',
		platform: 'node',
		logLevel: 'error'
	});
	const { BACKFILL_MEDIA_OBJECTS_SQL, COUNT_UNBACKFILLED_MEDIA_SQL } = await import(
		pathToFileURL(bundle).href
	);

	const wrangler = (...args) =>
		execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	const pending = () => {
		const [{ results }] = JSON.parse(
			wrangler(
				'd1',
				'execute',
				'DB',
				target,
				...configArgs,
				'--json',
				'--command',
				COUNT_UNBACKFILLED_MEDIA_SQL
			)
		);
		return results[0].n;
	};

	const before = pending();
	if (before === 0) {
		console.log('Nothing to backfill: every media file has an object.');
	} else {
		const file = join(dir, 'backfill.sql');
		writeFileSync(file, BACKFILL_MEDIA_OBJECTS_SQL.map((sql) => `${sql};`).join('\n') + '\n');
		wrangler('d1', 'execute', 'DB', target, ...configArgs, '--file', file);
		console.log(
			`Gave ${before - pending()} of ${before} media file${before === 1 ? '' : 's'} an object (${target.slice(2)}).`
		);
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}
