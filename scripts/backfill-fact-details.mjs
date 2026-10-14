// Moves the detail structures a tree kept as retained GEDCOM lines, in an event's extra lines (ADDR,
// TYPE, AGNC, RELI, PHON, EMAIL, FAX, WWW), into the event's columns. Imported before migration 0031,
// these lines were invisible and uneditable; the backfill makes them fields. Run it after
// the migration is applied and after the evidence and notes backfills, immediately after the deploy
// that carries migration 0031:
//
//   node scripts/backfill-fact-details.mjs            # local database
//   node scripts/backfill-fact-details.mjs --remote   # deployed database
//
// Until it has run, a merge-mode re-import duplicates facts that have an ADDR (the fact's key now
// includes its address), and filling an empty Address field in the editor leaves two ADDR lines on
// export. It is idempotent: a line is removed from the extra lines in the statement that stores it.
// A value already in its column is never replaced, and its line stays where it was.
//
// It cannot recover what earlier imports dropped: the sub-lines of PLAC (MAP, FORM, ...) were never
// kept. A replace-mode re-import of the file restores them.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { DEPLOY_CONFIG, requireDeployConfig } from './deploy-config.mjs';

const isRemote = process.argv.includes('--remote');
const target = isRemote ? '--remote' : '--local';
if (isRemote) requireDeployConfig();
const dir = mkdtempSync(join(tmpdir(), 'epoch-backfill-fact-details-'));

const bundle = join(dir, 'fact-detail-backfill.mjs');
await build({
	entryPoints: [
		new URL('../src/lib/server/gedcom/fact-detail-backfill.ts', import.meta.url).pathname
	],
	outfile: bundle,
	bundle: true,
	format: 'esm',
	platform: 'node',
	logLevel: 'error'
});
const { FACT_DETAIL_BACKFILL_QUERIES, factDetailBackfillStatements } = await import(
	pathToFileURL(bundle).href
);

const wrangler = (...args) =>
	execFileSync(
		'npx',
		[
			'wrangler',
			'd1',
			'execute',
			'DB',
			target,
			...(isRemote ? ['-c', DEPLOY_CONFIG] : []),
			...args
		],
		{
			encoding: 'utf8',
			maxBuffer: 512 * 1024 * 1024
		}
	);

const input = {};
for (const [name, sql] of Object.entries(FACT_DETAIL_BACKFILL_QUERIES)) {
	const [{ results }] = JSON.parse(wrangler('--json', '--command', sql));
	input[name] = results;
}

const statements = factDetailBackfillStatements(input);
if (statements.length === 0) {
	console.log('Nothing to backfill: no event details are kept as retained lines.');
	console.log(
		'Not recoverable here: PLAC sub-lines (MAP, FORM, ...) that earlier imports dropped. A replace-mode re-import of the file restores them.'
	);
	process.exit(0);
}

const file = join(dir, 'backfill.sql');
writeFileSync(file, statements.join('\n') + '\n');
wrangler('--file', file);
console.log(
	`Backfilled event details with ${statements.length} statement${statements.length === 1 ? '' : 's'} (${target.slice(2)}).`
);
console.log(
	'Not recoverable here: PLAC sub-lines (MAP, FORM, ...) that earlier imports dropped. A replace-mode re-import of the file restores them.'
);
