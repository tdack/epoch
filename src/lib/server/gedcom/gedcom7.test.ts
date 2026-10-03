import { describe, it, expect } from 'vitest';
import { parseGedcom, detectGedcomVersion } from './parser';
import { buildGedcom7String, buildGedcom551String, buildGedcomString } from './serializer';
import { SEX_X_TAG } from './tags';
import {
	REPRESENTATIVE_GEDCOM_7_FIXTURE,
	REPRESENTATIVE_GEDCOM_FIXTURE
} from '../fixtures/genealogy-fixtures';

describe('GEDCOM 7.0 support', () => {
	it('detects GEDCOM 7.0 from the header', () => {
		expect(detectGedcomVersion(REPRESENTATIVE_GEDCOM_7_FIXTURE)).toBe('7.0');
		expect(detectGedcomVersion(REPRESENTATIVE_GEDCOM_FIXTURE)).toBe('5.5.1');
	});

	it('parses GEDCOM 7 individuals, families, and non-binary sex', () => {
		const parsed = parseGedcom(REPRESENTATIVE_GEDCOM_7_FIXTURE);

		expect(parsed.version).toBe('7.0');
		expect(parsed.individuals).toHaveLength(5);
		expect(parsed.families).toHaveLength(2);

		const carol = parsed.individuals.find((i) => i.id === '@I_CAROL@');
		expect(carol?.sex).toBe('X');

		const david = parsed.individuals.find((i) => i.id === '@I_DAVID@');
		expect(david?.famc).toHaveLength(2);
	});

	it('preserves ranged dates with a sort end bound', () => {
		const parsed = parseGedcom(REPRESENTATIVE_GEDCOM_7_FIXTURE);
		const emily = parsed.individuals.find((i) => i.id === '@I_EMILY@');
		const birth = emily?.events.find((e) => e.type === 'BIRT');
		expect(birth?.dateRaw).toBe('BETWEEN 2000 AND 2002');
		expect(birth?.dateSort).toBe('2000-01-01');
		expect(birth?.dateSortEnd).toBe('2002-12-31');
	});

	it('builds a GEDCOM 7.0 string with SCHMA and no CHAR', () => {
		const parsed = parseGedcom(REPRESENTATIVE_GEDCOM_7_FIXTURE);

		const generated = buildGedcom7String({
			treeName: 'Test Lineage',
			individuals: parsed.individuals.map((ind) => ({
				id: ind.id,
				givenName: ind.givenName || null,
				surname: ind.surname || null,
				sex: ind.sex || null,
				events: ind.events.map((e) => ({
					type: e.type,
					dateRaw: e.dateRaw || null,
					place: e.place || null,
					description: e.description || null
				})),
				famc: ind.famc,
				fams: ind.fams
			})),
			families: parsed.families.map((f) => ({
				id: f.id,
				husbandId: f.husbandId || null,
				wifeId: f.wifeId || null,
				children: f.children.map((c) => ({ childId: c.childId, pedigree: c.pedigree || null })),
				events: f.events.map((e) => ({
					type: e.type,
					dateRaw: e.dateRaw || null,
					place: e.place || null,
					description: e.description || null
				}))
			}))
		});

		expect(generated).toContain('2 VERS 7.0');
		expect(generated).toContain('1 SCHMA');
		expect(generated).not.toContain('1 CHAR');
		expect(generated).toContain('1 SEX X');

		// Round-trip parse preserves individuals/families.
		const reParsed = parseGedcom(generated);
		expect(reParsed.version).toBe('7.0');
		expect(reParsed.individuals).toHaveLength(5);
		expect(reParsed.families).toHaveLength(2);
	});

	it('dispatch selects the requested format', () => {
		const parsed = parseGedcom(REPRESENTATIVE_GEDCOM_FIXTURE);
		const payload = {
			individuals: parsed.individuals.map((ind) => ({
				id: ind.id,
				givenName: ind.givenName || null,
				surname: ind.surname || null,
				sex: ind.sex || null,
				events: ind.events.map((e) => ({
					type: e.type,
					dateRaw: e.dateRaw || null,
					place: e.place || null,
					description: e.description || null
				})),
				famc: ind.famc,
				fams: ind.fams
			})),
			families: parsed.families.map((f) => ({
				id: f.id,
				husbandId: f.husbandId || null,
				wifeId: f.wifeId || null,
				children: f.children.map((c) => ({ childId: c.childId, pedigree: c.pedigree || null })),
				events: f.events.map((e) => ({
					type: e.type,
					dateRaw: e.dateRaw || null,
					place: e.place || null,
					description: e.description || null
				}))
			}))
		};

		const v551 = buildGedcomString(payload, 'gedcom551');
		const v7 = buildGedcomString(payload, 'gedcom7');

		expect(v551).toContain('2 VERS 5.5.1');
		expect(v7).toContain('2 VERS 7.0');
		expect(buildGedcomString(payload)).toBe(v551);
	});

	it('buildGedcom551String remains the default 5.5.1 output', () => {
		const parsed = parseGedcom(REPRESENTATIVE_GEDCOM_FIXTURE);
		const generated = buildGedcom551String({
			individuals: parsed.individuals.map((ind) => ({
				id: ind.id,
				givenName: ind.givenName || null,
				surname: ind.surname || null,
				sex: ind.sex || null,
				events: ind.events.map((e) => ({
					type: e.type,
					dateRaw: e.dateRaw || null,
					place: e.place || null,
					description: e.description || null
				})),
				famc: ind.famc,
				fams: ind.fams
			})),
			families: parsed.families.map((f) => ({
				id: f.id,
				husbandId: f.husbandId || null,
				wifeId: f.wifeId || null,
				children: f.children.map((c) => ({ childId: c.childId, pedigree: c.pedigree || null })),
				events: f.events.map((e) => ({
					type: e.type,
					dateRaw: e.dateRaw || null,
					place: e.place || null,
					description: e.description || null
				}))
			}))
		});
		expect(generated).toContain('2 VERS 5.5.1');
		expect(generated).toContain('1 CHAR UTF-8');
	});
});
/** Parse a file and hand its people back as an export payload, without families. */
function dataOf(ged: string) {
	return {
		treeName: 'T',
		individuals: parseGedcom(ged).individuals.map((ind) => ({
			id: ind.id,
			givenName: ind.givenName || null,
			surname: ind.surname || null,
			sex: ind.sex || null,
			events: [],
			famc: [],
			fams: []
		})),
		families: []
	};
}

describe('sex X (ADR-010)', () => {
	const ged = [
		'0 HEAD',
		'0 @I1@ INDI',
		'1 NAME Sam /Xu/',
		'1 SEX X',
		'0 @I2@ INDI',
		'1 NAME Una /Known/',
		'1 SEX U',
		'0 TRLR'
	].join('\n');

	it('is parsed as X and never collapsed to U', () => {
		expect(parseGedcom(ged).individuals.map((i) => i.sex)).toEqual(['X', 'U']);
	});

	it('is written as X in 7.0', () => {
		const out = buildGedcom7String(dataOf(ged));
		expect(out).toContain('1 SEX X');
		expect(out).not.toContain(SEX_X_TAG);
	});

	it('is written as U plus a custom line in 5.5.1, and read back as X', () => {
		const out = buildGedcom551String(dataOf(ged));
		expect(out).not.toMatch(/^1 SEX X$/m);
		expect(out).toContain(`1 SEX U\r\n1 ${SEX_X_TAG} X`);
		expect(parseGedcom(out).individuals.map((i) => i.sex)).toEqual(['X', 'U']);
	});
});
