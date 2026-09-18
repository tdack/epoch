import { describe, it, expect } from 'vitest';
import { migrateLegacyToNeutral } from './migration-adaptor';
import type { LegacyData, LegacyFamily, LegacyIndividual } from './migration-adaptor';

function individual(overrides: Partial<LegacyIndividual> & { id: string }): LegacyIndividual {
	return {
		treeId: 'tree-1',
		xrefId: null,
		givenName: null,
		surname: null,
		sex: 'U',
		version: 1,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides
	};
}

function family(overrides: Partial<LegacyFamily> & { id: string }): LegacyFamily {
	return {
		treeId: 'tree-1',
		xrefId: null,
		husbandId: null,
		wifeId: null,
		version: 1,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides
	};
}

describe('migrateLegacyToNeutral', () => {
	it('maps a husband/wife family to a union with ordered participants', () => {
		const data: LegacyData = {
			individuals: [
				individual({ id: 'p1', givenName: 'Alice', surname: 'Walker', sex: 'F' }),
				individual({ id: 'p2', givenName: 'Bob', surname: 'Smith', sex: 'M' })
			],
			families: [family({ id: 'f1', husbandId: 'p2', wifeId: 'p1' })],
			familyChildren: [],
			events: []
		};

		const { result, report } = migrateLegacyToNeutral(data);

		expect(result.unions).toHaveLength(1);
		expect(result.unions[0].id).toBe('f1');
		expect(result.unionPartners).toHaveLength(2);
		expect(result.unionPartners.map((p) => p.personId)).toEqual(['p2', 'p1']);
		expect(result.unionPartners.map((p) => p.order)).toEqual([0, 1]);
		expect(report.unions).toBe(1);
	});

	it('expands a family-wide pedigree into per-parent assertions', () => {
		const data: LegacyData = {
			individuals: [
				individual({ id: 'p1' }),
				individual({ id: 'p2' }),
				individual({ id: 'c1' })
			],
			families: [family({ id: 'f1', husbandId: 'p1', wifeId: 'p2' })],
			familyChildren: [{ familyId: 'f1', childId: 'c1', pedigree: 'adopted' }],
			events: []
		};

		const { result, report } = migrateLegacyToNeutral(data);

		expect(result.parentChild).toHaveLength(2);
		expect(result.parentChild.every((a) => a.type === 'adoptive')).toBe(true);
		expect(result.parentChild.every((a) => a.unionId === 'f1')).toBe(true);
		expect(report.parentChildAssertions).toBe(2);
	});

	it('derives divorced union status from a divorce event', () => {
		const data: LegacyData = {
			individuals: [individual({ id: 'p1' }), individual({ id: 'p2' })],
			families: [family({ id: 'f1', husbandId: 'p1', wifeId: 'p2' })],
			familyChildren: [],
			events: [
				{
					id: 'e1',
					treeId: 'tree-1',
					entityType: 'FAMILY',
					entityId: 'f1',
					type: 'DIV',
					dateRaw: '1999',
					dateSort: '1999-01-01',
					place: null,
					description: null,
					version: 1,
					createdAt: new Date(),
					updatedAt: new Date()
				}
			]
		};

		const { result, report } = migrateLegacyToNeutral(data);

		expect(result.unions[0].status).toBe('divorced');
		expect(report.divorcedUnions).toBe(1);
	});

	it('reports empty families rather than fabricating unions', () => {
		const data: LegacyData = {
			individuals: [],
			families: [family({ id: 'f1' })],
			familyChildren: [],
			events: []
		};

		const { result, report } = migrateLegacyToNeutral(data);

		expect(result.unions).toHaveLength(0);
		expect(report.emptyFamilies).toBe(1);
	});

	it('reports dangling child links and events', () => {
		const data: LegacyData = {
			individuals: [individual({ id: 'p1' })],
			families: [],
			familyChildren: [{ familyId: 'missing-fam', childId: 'p1', pedigree: 'birth' }],
			events: [
				{
					id: 'e1',
					treeId: 'tree-1',
					entityType: 'INDIVIDUAL',
					entityId: 'missing-person',
					type: 'BIRT',
					dateRaw: '1900',
					dateSort: '1900-01-01',
					place: null,
					description: null,
					version: 1,
					createdAt: new Date(),
					updatedAt: new Date()
				}
			]
		};

		const { report } = migrateLegacyToNeutral(data);

		expect(report.danglingChildLinks).toBe(1);
		expect(report.danglingEvents).toBe(1);
	});

	it('preserves approximate dates without fabricating exact days', () => {
		const data: LegacyData = {
			individuals: [individual({ id: 'p1' })],
			families: [],
			familyChildren: [],
			events: [
				{
					id: 'e1',
					treeId: 'tree-1',
					entityType: 'INDIVIDUAL',
					entityId: 'p1',
					type: 'BIRT',
					dateRaw: 'ABT 1900',
					dateSort: '1900-01-01',
					place: null,
					description: null,
					version: 1,
					createdAt: new Date(),
					updatedAt: new Date()
				}
			]
		};

		const { result } = migrateLegacyToNeutral(data);

		expect(result.events[0].date.qualifier).toBe('ABOUT');
		expect(result.events[0].date.precision).toBe('YEAR');
		expect(result.events[0].date.sortStart).toBe('1900-01-01');
		expect(result.events[0].date.sortEnd).toBe('1900-12-31');
	});
});