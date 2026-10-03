import { describe, expect, it } from 'vitest';
import { treeRows } from '../testing/rows';
import { livingCutoff } from './living-state';
import { NotFoundError } from './errors';
import {
	PRIVATE_PLACEHOLDER_NAME,
	maskForScope,
	maskRows,
	omitForScope,
	privatePeople,
	requireVisibleSubject,
	type MaskScope
} from './privacy-mask';

const CUTOFF = livingCutoff(new Date('2026-10-01T12:00:00Z'));

/** Gran (old, visible) and Liv (living) are partners; Kit is their child; Sam is Gran's other partner. */
function rows() {
	const r = treeRows({
		people: [
			{ id: 'gran', givenName: 'Gran', surname: 'Old' },
			{ id: 'liv', givenName: 'Liv', surname: 'Alive' },
			{ id: 'kit', givenName: 'Kit', surname: 'Old' },
			{ id: 'sam', givenName: 'Sam', surname: 'Dead' }
		],
		unions: [
			{ id: 'u1', partners: ['gran', 'liv'], marriage: '1990' },
			{ id: 'u2', partners: ['gran', 'sam'], marriage: '1870' }
		],
		links: [
			{ parentId: 'gran', childId: 'kit', unionId: 'u1' },
			{ parentId: 'liv', childId: 'kit', unionId: 'u1' }
		],
		events: [
			{ id: 'b-gran', entityId: 'gran', type: 'BIRT', dateRaw: '1850', dateSortEnd: '1850-12-31' },
			{ id: 'b-liv', entityId: 'liv', type: 'BIRT', dateRaw: '1985', dateSortEnd: '1985-12-31' },
			{ id: 'b-kit', entityId: 'kit', type: 'DEAT' },
			{ id: 'd-sam', entityId: 'sam', type: 'DEAT' }
		],
		names: [{ id: 'n-liv', personId: 'liv', type: 'married', givenName: 'Liv', surname: 'Zeta' }]
	});
	return r;
}

describe('privatePeople', () => {
	it('finds the living person only', () => {
		expect([...privatePeople(rows(), CUTOFF)]).toEqual(['liv']);
	});
	it('lets an override change it either way', () => {
		const r = rows();
		r.individuals.find((i) => i.id === 'liv')!.privacy = 'public';
		r.individuals.find((i) => i.id === 'sam')!.privacy = 'private';
		expect([...privatePeople(r, CUTOFF)]).toEqual(['sam']);
	});
});

describe('maskRows, omitting', () => {
	const { rows: masked, placeholderIds } = maskRows(rows(), CUTOFF, false);
	it('removes the person, their names and every row that names them', () => {
		expect(masked.individuals.map((i) => i.id).sort()).toEqual(['gran', 'kit', 'sam']);
		expect(masked.personNames).toEqual([]);
		expect(masked.unionPartners.every((p) => p.personId !== 'liv')).toBe(true);
		expect(masked.parentChild.map((l) => l.parentId)).toEqual(['gran']);
		expect(placeholderIds.size).toBe(0);
	});
	it('drops a partnership with a private partner, with its facts, so no page links to a dead end', () => {
		expect(masked.unions.map((u) => u.id)).toEqual(['u2']);
		expect(masked.unionPartners.map((p) => p.unionId).sort()).toEqual(['u2', 'u2']);
		expect(masked.events.filter((e) => e.entityType === 'FAMILY').map((e) => e.entityId)).toEqual([
			'u2'
		]);
	});
	it('leaves the visible parent a child of the person, without the partnership', () => {
		expect(masked.parentChild).toEqual([
			expect.objectContaining({ parentId: 'gran', childId: 'kit', unionId: null })
		]);
	});
	it('drops a partnership with nobody visible left, and unlinks its children', () => {
		const r = rows();
		r.individuals.find((i) => i.id === 'gran')!.privacy = 'private';
		const out = maskRows(r, CUTOFF, false).rows;
		// u1's partners are both private, and u2 has Gran as a partner, so neither stands.
		expect(out.unions.map((u) => u.id)).toEqual([]);
		expect(out.parentChild).toEqual([]);
	});
});

describe('maskRows, with placeholders', () => {
	const { rows: masked, placeholderIds } = maskRows(rows(), CUTOFF, true);
	it('keeps the structure and blanks the person', () => {
		const liv = masked.individuals.find((i) => i.id === 'liv')!;
		expect(liv).toMatchObject({
			givenName: PRIVATE_PLACEHOLDER_NAME,
			surname: null,
			xrefId: null,
			sex: 'U'
		});
		expect([...placeholderIds]).toEqual(['liv']);
		expect(masked.personNames).toEqual([]);
		expect(masked.events.some((e) => e.entityId === 'liv')).toBe(false);
		expect(masked.parentChild).toHaveLength(2);
		expect(masked.unionPartners).toHaveLength(4);
	});
	it('still withholds the partnership facts', () => {
		expect(masked.events.some((e) => e.entityType === 'FAMILY' && e.entityId === 'u1')).toBe(false);
	});
});

describe('maskRows with nobody private', () => {
	it('returns the rows untouched', () => {
		const r = rows();
		r.individuals.find((i) => i.id === 'liv')!.privacy = 'public';
		expect(maskRows(r, CUTOFF, false).rows).toBe(r);
	});
});

const scopeOf = (overrides: Partial<MaskScope> = {}): MaskScope => ({
	isRestricted: true,
	cutoff: CUTOFF,
	creatorId: null,
	shouldShowPrivateStructure: false,
	...overrides
});

describe('maskForScope and omitForScope', () => {
	it('hand a role that sees everyone the rows themselves', () => {
		const all = rows();
		const open = scopeOf({ isRestricted: false });
		expect(maskForScope(all, open)).toEqual({ rows: all, placeholderIds: new Set() });
		expect(omitForScope(all, open)).toBe(all);
	});

	it('mask a restricted viewer as the tree is set to', () => {
		const omitted = maskForScope(rows(), scopeOf());
		expect(omitted.rows.individuals.map((i) => i.id)).not.toContain('liv');
		const shown = maskForScope(rows(), scopeOf({ shouldShowPrivateStructure: true }));
		expect(shown.placeholderIds).toEqual(new Set(['liv']));
	});

	it('omitForScope never leaves a placeholder, even where the tree shows structure', () => {
		const omitted = omitForScope(rows(), scopeOf({ shouldShowPrivateStructure: true }));
		expect(omitted.individuals.map((i) => i.id)).not.toContain('liv');
		expect(omitted.individuals.some((i) => i.givenName === PRIVATE_PLACEHOLDER_NAME)).toBe(false);
	});
});

describe('requireVisibleSubject', () => {
	const window = { rows: rows(), foundStartIds: ['gran', 'liv'] };

	it('masks the window once every subject is found and visible', () => {
		const { rows: masked } = requireVisibleSubject(window, 'gran', scopeOf());
		expect(masked.individuals.map((i) => i.id)).not.toContain('liv');
	});

	it('answers a private subject as a missing one', () => {
		expect(() => requireVisibleSubject(window, ['gran', 'liv'], scopeOf())).toThrow(NotFoundError);
		expect(() => requireVisibleSubject(window, 'kit', scopeOf())).toThrow(NotFoundError);
	});

	it('lets a role that sees everyone ask for a private subject', () => {
		expect(() =>
			requireVisibleSubject(window, 'liv', scopeOf({ isRestricted: false }))
		).not.toThrow();
	});
});
