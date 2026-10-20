// Imports test/data/The Simpsons.ged into the local dev database through the running dev
// server, so the seed exercises the same importer and auth path as the app. Going through HTTP
// (rather than writing SQL) keeps this script from becoming a second implementation of import.
import { readFile } from 'node:fs/promises';

const baseUrl = (process.env.SEED_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const treeName = 'The Simpsons';
const gedcomPath = new URL('../test/data/The Simpsons.ged', import.meta.url);

async function main() {
	// No endpoint lists trees any more (ADR-067). `/` redirects to a tree whenever the user has
	// one and renders only when they have none, so a redirect means the database is already seeded.
	let hasTrees;
	try {
		const res = await fetch(`${baseUrl}/`, { redirect: 'manual' });
		hasTrees = res.status >= 300 && res.status < 400;
		if (!hasTrees && !res.ok) throw new Error(`GET / returned ${res.status}`);
	} catch (err) {
		console.error(
			`Could not reach the dev server at ${baseUrl} (${err.message}).\n` +
				'Start it with `npm run dev` (with ACCESS_BYPASS_DEV=true in .dev.vars) and run ' +
				'`npm run db:migrate:local` first. Set SEED_URL if it is not on port 5173.'
		);
		process.exit(1);
	}

	if (hasTrees) {
		console.log('The dev database already has a tree; nothing to do.');
		return;
	}

	const form = new FormData();
	form.set('file', new Blob([await readFile(gedcomPath)]), 'The Simpsons.ged');
	form.set('treeName', treeName);
	const res = await fetch(`${baseUrl}/api/import`, { method: 'POST', body: form });
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		console.error(`Import failed (${res.status}):`, body);
		process.exit(1);
	}
	console.log(`Imported "${treeName}" as tree ${body.treeId}.`);
}

await main();
