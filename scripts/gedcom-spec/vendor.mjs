// Refreshes scripts/gedcom-spec/source/ from a pinned FamilySearch/GEDCOM release tag.
// Usage: node scripts/gedcom-spec/vendor.mjs v7.0.18
// A tag, never a branch: the generated table must be reproducible from what is committed.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_URL = 'https://github.com/FamilySearch/GEDCOM';
const TSV_FILES = [
	'cardinalities.tsv',
	'enumerations.tsv',
	'enumerationsets.tsv',
	'payloads.tsv',
	'substructures.tsv'
];

const tag = process.argv[2];
if (!tag || !/^v7\.0\.\d+$/.test(tag)) {
	console.error('Usage: node scripts/gedcom-spec/vendor.mjs v7.0.<patch>');
	process.exit(1);
}

const sourceDir = join(dirname(fileURLToPath(import.meta.url)), 'source');
const scratch = mkdtempSync(join(tmpdir(), 'gedcom-spec-'));
const checkout = join(scratch, 'repo');
try {
	execFileSync(
		'git',
		['clone', '--quiet', '--depth', '1', '--branch', tag, REPOSITORY_URL, checkout],
		{ stdio: 'inherit' }
	);
	const commit = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], {
		encoding: 'utf8'
	}).trim();

	rmSync(sourceDir, { recursive: true, force: true });
	mkdirSync(sourceDir, { recursive: true });
	for (const name of TSV_FILES) {
		cpSync(join(checkout, 'extracted-files', name), join(sourceDir, name));
	}
	cpSync(join(checkout, 'extracted-files', 'tags'), join(sourceDir, 'tags'), { recursive: true });
	cpSync(join(checkout, 'LICENSE'), join(sourceDir, 'LICENSE'));
	cpSync(join(checkout, 'NOTICE'), join(sourceDir, 'NOTICE'));
	writeFileSync(
		join(sourceDir, 'SOURCE.json'),
		JSON.stringify({ repository: REPOSITORY_URL, tag, commit, license: 'Apache-2.0' }, null, '\t') +
			'\n'
	);
	console.log(`Vendored ${tag} (${commit}) into ${sourceDir}`);
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
