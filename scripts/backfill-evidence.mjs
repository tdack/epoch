// Moves the evidence a tree kept as retained GEDCOM lines (imported before migration 0020, ADR-028)
// into source, repository and citation records. Run it after the migration is applied:
//
//   node scripts/backfill-evidence.mjs            # local database
//   node scripts/backfill-evidence.mjs --remote   # deployed database
//
// It is idempotent: a line is removed from where it was kept in the same run that stores it, so a
// second run finds nothing to move. A line that cannot be placed is left where it is. The mapping is
// bundled from the app's own import code, so a backfilled tree and a freshly imported one agree.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const DATABASE = 'epoch-genealogy-db';
const target = process.argv.includes('--remote') ? '--remote' : '--local';
const dir = mkdtempSync(join(tmpdir(), 'epoch-backfill-evidence-'));

const bundle = join(dir, 'evidence-backfill.mjs');
await build({
	entryPoints: [new URL('../src/lib/server/gedcom/evidence-backfill.ts', import.meta.url).pathname],
	outfile: bundle,
	bundle: true,
	format: 'esm',
	platform: 'node',
	logLevel: 'error'
});
const { BACKFILL_QUERIES, evidenceBackfillStatements } = await import(pathToFileURL(bundle).href);

const wrangler = (...args) =>
	execFileSync('npx', ['wrangler', 'd1', 'execute', DATABASE, target, ...args], {
		encoding: 'utf8',
		maxBuffer: 512 * 1024 * 1024
	});

const input = {};
for (const [name, sql] of Object.entries(BACKFILL_QUERIES)) {
	const [{ results }] = JSON.parse(wrangler('--json', '--command', sql));
	input[name] = results;
}

const statements = evidenceBackfillStatements(input);
if (statements.length === 0) {
	console.log('Nothing to backfill: no evidence is kept as retained lines.');
	process.exit(0);
}

const file = join(dir, 'backfill.sql');
writeFileSync(file, statements.join('\n') + '\n');
wrangler('--file', file);
console.log(
	`Backfilled evidence with ${statements.length} statement${statements.length === 1 ? '' : 's'} (${target.slice(2)}).`
);
