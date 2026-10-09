// Keeps the stored date columns (ADR-004) in step with the parser. It fills events.date_sort_end,
// date_qualifier, date_precision and date_calendar for rows written before migration 0007, and it
// re-sorts dual dates (`30 JAN 1648/49`) in events, person names and citations, which were stored
// on their earlier year before the parser sorted them on the later one. Run it after a migration
// or a deploy that changes the parser:
//
//   node scripts/backfill-event-dates.mjs            # local database
//   node scripts/backfill-event-dates.mjs --remote   # deployed database
//
// It is idempotent: it only writes rows whose columns differ from what their date text derives.
// Reads never depend on it for undated columns (they parse date_raw as a fallback), but they do
// trust stored columns, so a stored dual date keeps its old sort until this runs. The parsing is
// bundled from the app's own code, so there is one parser.
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
const { backfillStatements, staleDatesSql, DATED_TABLES } = await import(
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
			maxBuffer: 256 * 1024 * 1024
		}
	);

const statements = [];
for (const dated of DATED_TABLES) {
	const [{ results }] = JSON.parse(wrangler('--json', '--command', staleDatesSql(dated)));
	const updates = backfillStatements(dated, results);
	if (updates.length > 0) console.log(`${dated.table}: ${updates.length} to update.`);
	statements.push(...updates);
}
if (statements.length === 0) {
	console.log('Nothing to backfill: every stored date already matches its date text.');
	process.exit(0);
}

const file = join(dir, 'backfill.sql');
writeFileSync(file, statements.join('\n') + '\n');
wrangler('--file', file);
console.log(
	`Backfilled ${statements.length} date${statements.length === 1 ? '' : 's'} (${target.slice(2)}).`
);
