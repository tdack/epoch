import { describe, expect, it } from 'vitest';
import { addYears, checkQuality, cyclesOf } from './quality-checks';
import { treeRows } from '../testing/rows';

const rulesOf = (rows: ReturnType<typeof treeRows>) => checkQuality(rows).map((f) => f.rule);

describe('addYears', () => {
	it('moves the year and keeps the rest, so day strings still compare', () => {
		expect(addYears('1900-03-04', 12)).toBe('1912-03-04');
		expect(addYears('0950-01-01', 5)).toBe('0955-01-01');
		expect(addYears('1900-02-29', 1) > '1900-02-28').toBe(true);
	});
});

describe('checks on one person', () => {
	it('flags a death certainly before the birth, and not one that merely might be', () => {
		const early = rulesOf(treeRows({ people: [{ id: 'a', birth: '1900', death: '1899' }] }));
		expect(early).toContain('death_before_birth');
		// One problem is one finding, not also a "fact before the birth".
		expect(early).not.toContain('fact_before_birth');
		expect(
			rulesOf(treeRows({ people: [{ id: 'a', birth: '1900', death: '1900' }] }))
		).not.toContain('death_before_birth');
		expect(
			rulesOf(treeRows({ people: [{ id: 'a', birth: 'BEF 1900', death: '1899' }] }))
		).not.toContain('death_before_birth');
		expect(rulesOf(treeRows({ people: [{ id: 'a', birth: '1 JAN 1900', death: true }] }))).toEqual(
			[]
		);
	});

	it('flags a lifespan over 120 years only when the dates make it certain', () => {
		expect(rulesOf(treeRows({ people: [{ id: 'a', birth: '1800', death: '1921' }] }))).toContain(
			'lifespan_over_120'
		);
		expect(
			rulesOf(treeRows({ people: [{ id: 'a', birth: '1800', death: '1920' }] }))
		).not.toContain('lifespan_over_120');
		expect(
			rulesOf(treeRows({ people: [{ id: 'a', birth: 'AFT 1800', death: '1921' }] }))
		).not.toContain('lifespan_over_120');
	});

	it('flags a fact before the birth, and a long-posthumous one, but not a burial or an attribute', () => {
		const rows = treeRows({
			people: [{ id: 'a', birth: '1900', death: '1950' }],
			events: [
				{ id: 'e1', entityId: 'a', type: 'CENS', dateRaw: '1890' },
				{ id: 'e2', entityId: 'a', type: 'CENS', dateRaw: '1953' },
				{ id: 'e3', entityId: 'a', type: 'BURI', dateRaw: '1960' },
				{ id: 'e4', entityId: 'a', type: 'RESI', dateRaw: '1800' },
				{ id: 'e5', entityId: 'a', type: 'CENS', dateRaw: '1951' }
			]
		});
		const found = checkQuality(rows).map((f) => `${f.rule}:${f.key.split(':')[1]}`);
		expect(found).toContain('fact_before_birth:e1');
		expect(found).toContain('fact_after_death:e2');
		expect(found).not.toContain('fact_after_death:e3');
		expect(found.filter((f) => f.endsWith(':e4'))).toEqual([]);
		// 1951 could be within a year of a death late in 1950.
		expect(found).not.toContain('fact_after_death:e5');
	});

	it('suggests a look when a person has two births that differ, and not when they agree', () => {
		const differ = treeRows({
			people: [{ id: 'a' }],
			events: [
				{ id: 'b1', entityId: 'a', type: 'BIRT', dateRaw: '1900' },
				{ id: 'b2', entityId: 'a', type: 'BIRT', dateRaw: '1901' }
			]
		});
		const agree = treeRows({
			people: [{ id: 'a' }],
			events: [
				{ id: 'b1', entityId: 'a', type: 'BIRT', dateRaw: '1900' },
				{ id: 'b2', entityId: 'a', type: 'BIRT', dateRaw: '1900' }
			]
		});
		expect(rulesOf(differ)).toContain('conflicting_births');
		expect(rulesOf(agree)).not.toContain('conflicting_births');
	});

	it('takes the widest span when a person has two births, so a conflict is not read as a certainty', () => {
		const rows = treeRows({
			people: [{ id: 'a', death: '1899' }],
			events: [
				{ id: 'b1', entityId: 'a', type: 'BIRT', dateRaw: '1890' },
				{ id: 'b2', entityId: 'a', type: 'BIRT', dateRaw: '1900' }
			]
		});
		expect(rulesOf(rows)).not.toContain('death_before_birth');
	});

	it('names a fact that belongs to nobody', () => {
		const rows = treeRows({
			people: [{ id: 'a' }],
			events: [
				{ id: 'x', entityId: 'gone', type: 'BIRT' },
				{ id: 'y', entityId: 'gone-union', type: 'MARR', entityType: 'FAMILY' }
			]
		});
		expect(checkQuality(rows).filter((f) => f.rule === 'orphan_fact')).toHaveLength(2);
	});
});

describe('checks on parents and children', () => {
	const family = (
		parent: { birth?: string; death?: string },
		child: { birth?: string },
		type: 'biological' | 'adoptive' = 'biological'
	) =>
		treeRows({
			people: [
				{ id: 'p', ...parent },
				{ id: 'c', ...child }
			],
			links: [{ parentId: 'p', childId: 'c', type }]
		});

	it('flags a child born before their parent, and a parent who was a child', () => {
		expect(rulesOf(family({ birth: '1900' }, { birth: '1890' }))).toContain('child_before_parent');
		expect(rulesOf(family({ birth: '1900' }, { birth: '1905' }))).toContain('parent_too_young');
		expect(rulesOf(family({ birth: '1900' }, { birth: '1912' }))).not.toContain('parent_too_young');
		// One finding per link: a parent born after the child is not also called too young.
		expect(rulesOf(family({ birth: '1900' }, { birth: '1890' }))).not.toContain('parent_too_young');
	});

	it('allows a child born after a parent died within a year, and flags one born long after', () => {
		expect(rulesOf(family({ death: '1900' }, { birth: '1900' }))).not.toContain(
			'child_after_parent_death'
		);
		expect(rulesOf(family({ death: '1900' }, { birth: '1901' }))).not.toContain(
			'child_after_parent_death'
		);
		expect(rulesOf(family({ death: '1900' }, { birth: '1902' }))).toContain(
			'child_after_parent_death'
		);
	});

	it('does not measure an adoptive parent by birth dates', () => {
		expect(rulesOf(family({ birth: '1900' }, { birth: '1890' }, 'adoptive'))).not.toContain(
			'child_before_parent'
		);
	});

	it('flags the same link twice, and suggests the other parent when only one is known', () => {
		const rows = treeRows({
			people: [{ id: 'p' }, { id: 'c' }],
			links: [
				{ parentId: 'p', childId: 'c' },
				{ parentId: 'p', childId: 'c' }
			]
		});
		expect(rulesOf(rows)).toEqual(
			expect.arrayContaining(['duplicate_parent_link', 'one_parent_recorded'])
		);
		const two = treeRows({
			people: [{ id: 'p' }, { id: 'q' }, { id: 'c' }],
			links: [
				{ parentId: 'p', childId: 'c' },
				{ parentId: 'q', childId: 'c' }
			]
		});
		expect(rulesOf(two)).toEqual([]);
	});
});

describe('possible duplicate people', () => {
	const twinsWith = (a: string | undefined, b: string | undefined) =>
		treeRows({
			people: [
				{ id: 'a', givenName: 'Ann', surname: 'Ash', birth: a },
				{ id: 'b', givenName: 'ann', surname: 'ASH', birth: b }
			]
		});

	it('needs the same name and births that could match, and never a name alone', () => {
		expect(rulesOf(twinsWith('1900', '1900'))).toContain('possible_duplicate_person');
		expect(rulesOf(twinsWith('1900', 'ABT 1900'))).toContain('possible_duplicate_person');
		expect(rulesOf(twinsWith('1900', '1920'))).not.toContain('possible_duplicate_person');
		expect(rulesOf(twinsWith(undefined, '1900'))).not.toContain('possible_duplicate_person');
		expect(rulesOf(twinsWith(undefined, undefined))).not.toContain('possible_duplicate_person');
	});

	it('is one finding for a group of namesakes, naming only those who could be the same', () => {
		const people = Array.from({ length: 20 }, (_, i) => ({
			id: `p${i}`,
			givenName: 'John',
			surname: 'Smith',
			birth: String(1700 + i * 10)
		}));
		const found = checkQuality(
			treeRows({
				people: [...people, { id: 'twin', givenName: 'John', surname: 'Smith', birth: '1700' }]
			})
		).filter((f) => f.rule === 'possible_duplicate_person');
		expect(found).toHaveLength(1);
		expect(found[0]!.subjects.map((s) => s.id).sort()).toEqual(['p0', 'twin']);
		expect(found[0]!.severity).toBe('suggestion');
	});

	it('does not suggest a person is their own duplicate across different names', () => {
		const rows = treeRows({
			people: [
				{ id: 'a', givenName: 'Ann', surname: 'Ash', birth: '1900' },
				{ id: 'b', givenName: 'Ann', surname: 'Birch', birth: '1900' }
			]
		});
		expect(rulesOf(rows)).not.toContain('possible_duplicate_person');
	});
});

describe('partnerships and cycles', () => {
	it('suggests a look at two partnerships with the same partners, in either order, and never for different ones', () => {
		const rows = treeRows({
			people: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
			unions: [
				{ id: 'u1', partners: ['a', 'b'] },
				{ id: 'u2', partners: ['b', 'a'] },
				{ id: 'u3', partners: ['a', 'c'] }
			]
		});
		const found = checkQuality(rows).filter((f) => f.rule === 'duplicate_partnership');
		expect(found).toHaveLength(1);
		expect(found[0]!.subjects.map((s) => s.id).sort()).toEqual(['u1', 'u2']);
		expect(found[0]!.severity).toBe('suggestion');
	});

	it('finds a loop of parents and a person who is their own parent, and nothing in a plain tree', () => {
		expect(
			cyclesOf([
				['a', 'b'],
				['b', 'c'],
				['c', 'a'],
				['c', 'd']
			])
		).toEqual([['a', 'b', 'c']]);
		expect(cyclesOf([['a', 'a']])).toEqual([['a']]);
		expect(
			cyclesOf([
				['a', 'b'],
				['b', 'c'],
				['a', 'c']
			])
		).toEqual([]);
		const rows = treeRows({
			people: [{ id: 'a' }, { id: 'b' }],
			links: [
				{ parentId: 'a', childId: 'b' },
				{ parentId: 'b', childId: 'a' }
			]
		});
		const [loop] = checkQuality(rows).filter((f) => f.rule === 'ancestor_cycle');
		expect(loop!.message).toContain("each other's ancestors");
		expect(loop!.severity).toBe('error');
	});

	it('handles a long chain without recursing off the stack', () => {
		const edges = Array.from({ length: 20_000 }, (_, i) => [`n${i}`, `n${i + 1}`] as const);
		expect(cyclesOf(edges)).toEqual([]);
	});
});

describe('findings are stable', () => {
	it('gives the same findings, in the same order and with the same keys, however the rows are ordered', () => {
		const spec = {
			people: [
				{ id: 'a', birth: '1900', death: '1899' },
				{ id: 'b', birth: '1800', death: '1990' }
			],
			links: [{ parentId: 'a', childId: 'b' }]
		};
		const forward = checkQuality(treeRows(spec));
		const reversed = checkQuality(treeRows({ ...spec, people: [...spec.people].reverse() }));
		expect(reversed).toEqual(forward);
		expect(new Set(forward.map((f) => f.key)).size).toBe(forward.length);
	});
});
