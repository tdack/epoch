// Fills events.date_sort_end, date_qualifier, date_precision and date_calendar from date_raw for
// rows written before migration 0007 (ADR-004). Run it after the migration is applied:
//
//   node scripts/backfill-event-dates.mjs            # local database
//   node scripts/backfill-event-dates.mjs --remote   # deployed database
//
// It is idempotent and only touches rows whose date_qualifier is still null. Reads never depend
// on it (they parse date_raw as a fallback); it exists so sorting and filtering by date can use
// the stored bounds. The parsing is bundled from the app's own code, so there is one parser.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const DATABASE = 'epoch-genealogy-db';
const target = process.argv.includes('--remote') ? '--remote' : '--local';
const dir = mkdtempSync(join(tmpdir(), 'epoch-backfill-'));

const bundle = join(dir, 'date-backfill.mjs');
await build({
	entryPoints: [new URL('../src/lib/server/domain/date-backfill.ts', import.meta.url).pathname],
	outfile: bundle,
	bundle: true,
	format: 'esm',
	platform: 'node',
	logLevel: 'error'
});
const { backfillStatements, UNBACKFILLED_EVENTS_SQL } = await import(pathToFileURL(bundle).href);

const wrangler = (...args) =>
	execFileSync('npx', ['wrangler', 'd1', 'execute', DATABASE, target, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const [{ results }] = JSON.parse(wrangler('--json', '--command', UNBACKFILLED_EVENTS_SQL));
if (results.length === 0) {
	console.log('Nothing to backfill: every dated event already has its structured date.');
	process.exit(0);
}

const file = join(dir, 'backfill.sql');
writeFileSync(file, backfillStatements(results).join('\n') + '\n');
wrangler('--file', file);
console.log(`Backfilled ${results.length} event date${results.length === 1 ? '' : 's'} (${target.slice(2)}).`);
