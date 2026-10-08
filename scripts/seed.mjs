// Imports docs/gedcom-data/The_Simpsons_clean.ged into the local dev database through the running dev
// server, so the seed exercises the same importer and auth path as the app. Going through HTTP
// (rather than writing SQL) keeps this script from becoming a second implementation of import.
import { readFile } from 'node:fs/promises';

const baseUrl = (process.env.SEED_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const treeName = 'The Simpsons';
const gedcomPath = new URL('../docs/gedcom-data/The_Simpsons_clean.ged', import.meta.url);

async function main() {
	let trees;
	try {
		const res = await fetch(`${baseUrl}/api/trees`);
		if (!res.ok) throw new Error(`GET /api/trees returned ${res.status}`);
		trees = (await res.json()).trees;
	} catch (err) {
		console.error(
			`Could not reach the dev server at ${baseUrl} (${err.message}).\n` +
				'Start it with `npm run dev` (with ACCESS_BYPASS_DEV=true in .dev.vars) and run ' +
				'`npm run db:migrate:local` first. Set SEED_URL if it is not on port 5173.'
		);
		process.exit(1);
	}

	const existing = trees.find((t) => t.name === treeName);
	if (existing) {
		console.log(`"${treeName}" already exists (${existing.id}); nothing to do.`);
		return;
	}

	const form = new FormData();
	form.set('file', new Blob([await readFile(gedcomPath)]), 'The_Simpsons_clean.ged');
	form.set('treeName', treeName);
	const res = await fetch(`${baseUrl}/api/import`, { method: 'POST', body: form });
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		console.error(`Import failed (${res.status}):`, body);
		process.exit(1);
	}
	console.log(`Imported "${treeName}" as tree ${body.treeId ?? '(see /api/trees)'}.`);
}

await main();
