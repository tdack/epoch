// Moves the notes a tree kept as retained GEDCOM lines, in a row's extra lines, or in a fact's `notes`
// column (imported before migration 0021, ADR-029) into note records. Run it after the migration is
// applied and after the evidence backfill (a note under a source, a repository or a citation can only
// be reached once those are records):
//
//   node scripts/backfill-notes.mjs            # local database
//   node scripts/backfill-notes.mjs --remote   # deployed database
//
// It is idempotent: a line is removed from where it was kept in the same run that stores it, so a
// second run finds nothing to move. A line that cannot be placed is left where it is. It never turns
// a free-text note into a citation or a source. The mapping is bundled from the app's own import
// code, so a backfilled tree and a freshly imported one agree.
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
const dir = mkdtempSync(join(tmpdir(), 'epoch-backfill-notes-'));

const bundle = join(dir, 'note-backfill.mjs');
await build({
	entryPoints: [new URL('../src/lib/server/gedcom/note-backfill.ts', import.meta.url).pathname],
	outfile: bundle,
	bundle: true,
	format: 'esm',
	platform: 'node',
	logLevel: 'error'
});
const { NOTE_BACKFILL_QUERIES, noteBackfillStatements } = await import(pathToFileURL(bundle).href);

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
for (const [name, sql] of Object.entries(NOTE_BACKFILL_QUERIES)) {
	const [{ results }] = JSON.parse(wrangler('--json', '--command', sql));
	input[name] = results;
}

const statements = noteBackfillStatements(input);
if (statements.length === 0) {
	console.log('Nothing to backfill: no notes are kept as retained lines.');
	process.exit(0);
}

const file = join(dir, 'backfill.sql');
writeFileSync(file, statements.join('\n') + '\n');
wrangler('--file', file);
console.log(
	`Backfilled notes with ${statements.length} statement${statements.length === 1 ? '' : 's'} (${target.slice(2)}).`
);
