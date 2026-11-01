import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { getTreeExportData, importGedcomToDb } from '../testing/gedcom';
import { semanticDiff } from './semantic-diff';
import { buildGedcom551String, buildGedcom7String } from './serializer';
import { validateGedcom7 } from './validate7';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const original = [
	'0 HEAD',
	'1 GEDC',
	'2 VERS 7.0',
	'0 @I1@ INDI',
	'1 NAME Joseph "John" /de Allen/ jr.',
	'1 NAME Aka',
	'1 NAME Pat /Poe/',
	'2 TYPE MARRIED',
	'0 TRLR'
].join('\n');

async function seed() {
	const treeId = crypto.randomUUID();
	await importGedcomToDb(t.d1, treeId, original, 'Names');
	return getTreeExportData(t.d1, treeId);
}

describe('a NAME line written as the file gave it (ADR-013)', () => {
	it('keeps the payload and the absence of TYPE, with no diff and no validator error', async () => {
		const text = buildGedcom7String(await seed());
		expect(text).toContain('1 NAME Joseph "John" /de Allen/ jr.\r\n');
		expect(text).toContain('1 NAME Aka\r\n');
		expect(text).not.toContain('TYPE AKA');
		expect(text).not.toContain('NAME Aka //');
		expect(validateGedcom7(text).errors).toEqual([]);
		expect(semanticDiff(original, text).isEmpty).toBe(true);
	});

	it('reads back as the same model, so a second trip is the same text', async () => {
		const first = buildGedcom551String(await seed());
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, first, 'Again');
		expect(buildGedcom551String(await getTreeExportData(t.d1, treeId))).toContain(
			'1 NAME Joseph "John" /de Allen/ jr.\r\n'
		);
	});

	it('writes the canonical line once a part has been edited', async () => {
		const data = await seed();
		const names = data.individuals[0].names!;
		names[0].suffix = 'sr.';
		const text = buildGedcom7String(data);
		expect(text).not.toContain('/de Allen/ jr.');
		expect(text).toContain('/ sr.');
	});

	it('writes TYPE once a name has been given a different one', async () => {
		const data = await seed();
		data.individuals[0].names![1].type = 'immigrant';
		expect(buildGedcom7String(data)).toContain('2 TYPE IMMIGRANT');
	});
});
