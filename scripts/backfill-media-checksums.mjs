// Fills media_items.sha256 and crc32 for files stored before uploads computed them (ADR-082). The
// hourly cron does the same a few files at a time; this is for clearing a backlog at once. Run:
//
//   node scripts/backfill-media-checksums.mjs            # local database and bucket
//   node scripts/backfill-media-checksums.mjs --remote   # deployed database and bucket
//
// Wrangler cannot list or head R2 objects, so each file is downloaded to a scratch file and read
// once, hashing both checksums in a single pass. It is idempotent: only resolved rows missing
// either checksum are read, and an unresolved row (its key is a placeholder) is never touched. A
// file that cannot be read stays null and is named in the output, so the rest can be retried.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEPLOY_CONFIG, requireDeployConfig } from './deploy-config.mjs';

const isRemote = process.argv.includes('--remote');
const target = isRemote ? '--remote' : '--local';
if (isRemote) requireDeployConfig();
const configArgs = isRemote ? ['-c', DEPLOY_CONFIG] : [];
const configFile = isRemote ? DEPLOY_CONFIG : 'wrangler.jsonc';

const bucketMatch = readFileSync(configFile, 'utf8').match(
	/"binding"\s*:\s*"MEDIA_BUCKET"\s*,\s*"bucket_name"\s*:\s*"([^"]+)"/
);
if (!bucketMatch) throw new Error(`No MEDIA_BUCKET bucket_name in ${configFile}`);
const bucketName = bucketMatch[1];

const wrangler = (...args) =>
	execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// The same table as src/lib/server/gedcom/crc32.ts; duplicated because a script cannot import TS.
const TABLE = new Uint32Array(256).map((_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

async function checksumsOf(file) {
	const hash = createHash('sha256');
	let c = 0xffffffff;
	for await (const chunk of createReadStream(file)) {
		hash.update(chunk);
		for (let i = 0; i < chunk.length; i++) c = TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
	}
	return { sha256: hash.digest('hex'), crc32: ~c >>> 0 };
}

const [{ results: rows }] = JSON.parse(
	wrangler(
		'd1',
		'execute',
		'DB',
		target,
		...configArgs,
		'--json',
		'--command',
		"select id, r2_object_key from media_items where (status is null or status = 'resolved') and r2_object_key not like 'unresolved/%' and (sha256 is null or crc32 is null)"
	)
);
if (rows.length === 0) {
	console.log('Nothing to backfill: every media file has its checksums.');
	process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'epoch-backfill-media-checksums-'));
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
			const { sha256, crc32 } = await checksumsOf(scratch);
			const id = row.id.replace(/'/g, "''");
			statements.push(
				`update media_items set sha256 = '${sha256}', crc32 = ${crc32} where id = '${id}';`
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
	`Recorded checksums for ${statements.length} of ${rows.length} media file${rows.length === 1 ? '' : 's'} (${target.slice(2)}).`
);
if (unreadable.length > 0) {
	console.log(`Could not read ${unreadable.length} object(s), left unchecked:`);
	for (const key of unreadable) console.log(`  ${key}`);
}
