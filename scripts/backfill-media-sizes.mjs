// Records the size of media files stored before migration 0029 kept one. Their size_bytes is null
// until this runs, and the Files manager shows "unknown" for them. Run after the migration is applied:
//
//   node scripts/backfill-media-sizes.mjs            # local database and bucket
//   node scripts/backfill-media-sizes.mjs --remote   # deployed database and bucket
//
// Wrangler cannot list or head R2 objects, so each file with no size is downloaded to a scratch
// file and measured. That is one download per legacy file: slow for a large library, and run once.
// It is idempotent: only rows with no size are written. A file that cannot be read stays null and
// is named in the output, so the rest can be retried.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEPLOY_CONFIG, requireDeployConfig } from './deploy-config.mjs';

const isRemote = process.argv.includes('--remote');
const target = isRemote ? '--remote' : '--local';
if (isRemote) requireDeployConfig();
const configArgs = isRemote ? ['-c', DEPLOY_CONFIG] : [];
const configFile = isRemote ? DEPLOY_CONFIG : 'wrangler.jsonc';

// The bucket is named in the config the target uses, so the script cannot read a different bucket
// than the Worker writes to.
const bucketMatch = readFileSync(configFile, 'utf8').match(
	/"binding"\s*:\s*"MEDIA_BUCKET"\s*,\s*"bucket_name"\s*:\s*"([^"]+)"/
);
if (!bucketMatch) throw new Error(`No MEDIA_BUCKET bucket_name in ${configFile}`);
const bucketName = bucketMatch[1];

const wrangler = (...args) =>
	execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const [{ results: rows }] = JSON.parse(
	wrangler(
		'd1',
		'execute',
		'DB',
		target,
		...configArgs,
		'--json',
		'--command',
		'select id, r2_object_key from media_items where size_bytes is null'
	)
);
if (rows.length === 0) {
	console.log('Nothing to backfill: every media file has a size.');
	process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'epoch-backfill-media-sizes-'));
const statements = [];
const unreadable = [];
try {
	const scratch = join(dir, 'object');
	for (const row of rows) {
		try {
			wrangler(
				'r2',
				'object',
				'get',
				`${bucketName}/${row.r2_object_key}`,
				target,
				...configArgs,
				'--file',
				scratch
			);
			const size = statSync(scratch).size;
			const id = row.id.replace(/'/g, "''");
			statements.push(
				`update media_items set size_bytes = ${size} where id = '${id}' and size_bytes is null;`
			);
		} catch {
			unreadable.push(row.r2_object_key);
		} finally {
			rmSync(scratch, { force: true });
		}
	}
	if (statements.length > 0) {
		const file = join(dir, 'backfill.sql');
		writeFileSync(file, statements.join('\n') + '\n');
		wrangler('d1', 'execute', 'DB', target, ...configArgs, '--file', file);
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}

console.log(
	`Recorded sizes for ${statements.length} of ${rows.length} media file${rows.length === 1 ? '' : 's'} (${target.slice(2)}).`
);
if (unreadable.length > 0) {
	console.log(`Could not read ${unreadable.length} object(s), left unsized:`);
	for (const key of unreadable) console.log(`  ${key}`);
}
