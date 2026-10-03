import { describe, it, expect } from 'vitest';
import { parseGedcom } from '../gedcom/parser';
import { buildGedcom551String } from '../gedcom/serializer';
import { REPRESENTATIVE_GEDCOM_FIXTURE } from './genealogy-fixtures';

describe('Representative Genealogy Scenarios Fixture', () => {
	it('parses complex relationships including two families per child, adoption, foster, and remarriage', () => {
		const parsed = parseGedcom(REPRESENTATIVE_GEDCOM_FIXTURE);

		expect(parsed.individuals).toHaveLength(5);
		expect(parsed.families).toHaveLength(2);

		// David should be linked to both parental families
		const david = parsed.individuals.find((i) => i.id === '@I_DAVID@');
		expect(david).toBeDefined();
		expect(david?.famc).toHaveLength(2);
		expect(david?.famc).toContain('@F_WALKER_SMITH@');
		expect(david?.famc).toContain('@F_WALKER_JONES@');

		// Emily should have foster pedigree
		const famJones = parsed.families.find((f) => f.id === '@F_WALKER_JONES@');
		expect(famJones).toBeDefined();
		const emilyLink = famJones?.children.find((c) => c.childId === '@I_EMILY@');
		expect(emilyLink?.pedigree).toBe('foster');

		const davidAdopted = famJones?.children.find((c) => c.childId === '@I_DAVID@');
		expect(davidAdopted?.pedigree).toBe('adopted');

		// Alice has two partnerships (remarriage after divorce/death)
		const alice = parsed.individuals.find((i) => i.id === '@I_ALICE@');
		expect(alice).toBeDefined();
		expect(alice?.fams).toHaveLength(2);

		// Events parse correctly
		const famSmith = parsed.families.find((f) => f.id === '@F_WALKER_SMITH@');
		expect(famSmith?.events.some((e) => e.type === 'MARR')).toBe(true);
		expect(famSmith?.events.some((e) => e.type === 'DIV')).toBe(true);
	});

	it('round-trips the representative scenario through GEDCOM generator', () => {
		const parsed = parseGedcom(REPRESENTATIVE_GEDCOM_FIXTURE);
		const serialized = buildGedcom551String({
			treeName: 'Epoch Test Lineage',
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

		expect(serialized).toContain('0 @I_ALICE@ INDI');
		expect(serialized).toContain('0 @I_DAVID@ INDI');
		expect(serialized).toContain('0 @F_WALKER_SMITH@ FAM');
		expect(serialized).toContain('0 @F_WALKER_JONES@ FAM');
		expect(serialized).toContain('1 DIV');

		const reParsed = parseGedcom(serialized);
		expect(reParsed.individuals).toHaveLength(5);
		expect(reParsed.families).toHaveLength(2);
	});
});
