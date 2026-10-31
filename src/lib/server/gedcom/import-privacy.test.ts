import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { gedcomPreserved, individuals } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { parseGedcom } from './parser';
import { buildGedcom551String, buildGedcom7String } from './serializer';
import { getTreeExportData, importGedcomToDb } from '../testing/gedcom';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const ged = [
	'0 HEAD',
	'0 @I1@ INDI',
	'1 NAME Pat /Private/',
	'1 RESN privacy',
	'0 @I2@ INDI',
	'1 NAME Con /Fidential/',
	'1 RESN CONFIDENTIAL, LOCKED',
	'0 @I3@ INDI',
	'1 NAME Pub /Lic/',
	'1 _EPOCH_PRIVACY public',
	'0 @I4@ INDI',
	'1 NAME Lock /Only/',
	'1 RESN locked',
	'0 @I5@ INDI',
	'1 NAME Plain /Person/',
	'0 TRLR'
].join('\n');

const privacyByName = async (treeId: string) =>
	Object.fromEntries(
		(await t.db.select().from(individuals).where(eq(individuals.treeId, treeId)).all()).map((i) => [
			i.surname,
			i.privacy
		])
	);

describe('RESN and the privacy override (ADR-015)', () => {
	it('parses a restriction as private, and keeps a word it does not model', () => {
		const people = Object.fromEntries(parseGedcom(ged).individuals.map((i) => [i.id, i.privacy]));
		expect(people).toEqual({
			'@I1@': 'private',
			'@I2@': 'private',
			'@I3@': 'public',
			'@I4@': undefined,
			'@I5@': undefined
		});
	});

	it('stores the override, and does not also keep the RESN line', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, ged, 'Privacy');
		expect(await privacyByName(treeId)).toEqual({
			Private: 'private',
			Fidential: 'private',
			Lic: 'public',
			Only: 'auto',
			Person: 'auto'
		});
		const kept = (
			await t.db.select().from(gedcomPreserved).where(eq(gedcomPreserved.treeId, treeId)).all()
		).flatMap((p) => p.lines as string[]);
		// Only a list the override cannot say survives as a RESN line: CONFIDENTIAL with its LOCKED, and
		// LOCKED on its own. A bare `privacy` is the override itself.
		expect(kept.filter((l) => l.includes('RESN')).sort()).toEqual([
			'1 RESN CONFIDENTIAL, LOCKED',
			'1 RESN locked'
		]);
	});

	it('survives an export and re-import in both GEDCOM versions', async () => {
		const first = crypto.randomUUID();
		await importGedcomToDb(t.d1, first, ged, 'Privacy');
		const data = await getTreeExportData(t.d1, first);
		const text551 = buildGedcom551String(data);
		const text7 = buildGedcom7String(data);
		expect(text551).toContain('1 RESN privacy');
		expect(text7).toContain('1 RESN PRIVACY');
		for (const text of [text551, text7]) {
			const again = crypto.randomUUID();
			await importGedcomToDb(t.d1, again, text, 'Again');
			expect(await privacyByName(again)).toEqual({
				Private: 'private',
				Fidential: 'private',
				Lic: 'public',
				Only: 'auto',
				Person: 'auto'
			});
		}
	});

	it('writes a RESN list as one line in 7.0, and drops its restricting word once the person is not private', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, ged, 'Privacy');
		const data = await getTreeExportData(t.d1, treeId);
		const text7 = buildGedcom7String(data);
		expect(text7.match(/^1 RESN CONFIDENTIAL, LOCKED\r$/gm)).toHaveLength(1);
		expect(text7.match(/^1 RESN .*LOCKED/gim)).toHaveLength(2);
		// Opened up since the import, the person is no longer confidential; the LOCKED stays.
		const fidential = data.individuals.find((i) => i.surname === 'Fidential')!;
		fidential.privacy = 'auto';
		const opened = buildGedcom7String(data);
		expect(opened).not.toContain('CONFIDENTIAL');
		expect(buildGedcom551String(data).match(/^1 RESN locked/gim)).toHaveLength(2);
	});
});
