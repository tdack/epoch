import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import factDetails from '../../../../test/data/fact-details.ged?raw';
import windsors from '../../../../test/data/The Windsors.ged?raw';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { getTreeExportData, importGedcomToDb } from '../testing/gedcom';
import { parseGedcom } from './parser';
import { buildGedcom551String, buildGedcom7String } from './serializer';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

/** The records of a file, from its first record on: the header is written afresh by each export. */
function recordLines(text: string): string[] {
	const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim() !== '');
	const start = lines.findIndex((line) => /^0 @/.test(line));
	return lines.slice(start).filter((line) => line !== '0 TRLR');
}

/** Every line of `input` is in `output`, counting repeats, whatever the order. */
function missingLines(input: string[], output: string[]): string[] {
	const left = new Map<string, number>();
	for (const line of output) left.set(line, (left.get(line) ?? 0) + 1);
	const missing: string[] = [];
	for (const line of input) {
		const count = left.get(line) ?? 0;
		if (count > 0) left.set(line, count - 1);
		else missing.push(line);
	}
	return missing;
}

describe('fact details survive an import and an export', () => {
	it('writes every line of the 5.5.1 file back', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, factDetails, 'Fact details');
		const output = buildGedcom551String(await getTreeExportData(t.d1, treeId));

		expect(missingLines(recordLines(factDetails), recordLines(output))).toEqual([]);
	});

	// GEDCOM 7 has no CONC and writes RESN in capitals, so the 5.5.1 file is not its own 7.0 text.
	// The 7.0 check starts from a 7.0 export: re-reading it and writing it again must give it back.
	it('writes every line of a 7.0 export back, after reading it', async () => {
		const first = crypto.randomUUID();
		await importGedcomToDb(t.d1, first, factDetails, 'Fact details');
		const written = buildGedcom7String(await getTreeExportData(t.d1, first));

		const second = crypto.randomUUID();
		await importGedcomToDb(t.d1, second, written, 'Fact details');
		const again = buildGedcom7String(await getTreeExportData(t.d1, second));

		expect(missingLines(recordLines(written), recordLines(again))).toEqual([]);
		expect(recordLines(written)).toContain('2 ADDR 3 Grosvenor Place');
	});
});

describe('The Windsors file', () => {
	const parsed = parseGedcom(windsors);
	const modelled = [...parsed.individuals, ...parsed.families].flatMap((record) =>
		record.events.filter((ev) => ev.address !== undefined)
	);
	const countOf = (type: string) => modelled.filter((ev) => ev.type === type).length;

	it('models every address under an event, by event type', () => {
		expect(modelled).toHaveLength(61);
		expect(countOf('BIRT')).toBe(22);
		expect(countOf('DEAT')).toBe(12);
		expect(countOf('BURI')).toBe(9);
		expect(countOf('BAPM')).toBe(3);
		expect(countOf('MARR')).toBe(15);
	});

	it('leaves no address in any event extra lines', () => {
		const kept = [...parsed.individuals, ...parsed.families].flatMap((record) =>
			record.events.flatMap((ev) => ev.extra ?? [])
		);
		expect(kept.filter((line) => /^\d+ ADDR\b/.test(line))).toEqual([]);
	});

	it('keeps the address under _INTE, which is not an event, in the preserved lines', () => {
		const preserved = parsed.preserved.flatMap((entry) => entry.lines);
		expect(preserved.filter((line) => /^\d+ ADDR\b/.test(line))).toHaveLength(1);
	});
});
