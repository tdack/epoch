import { describe, expect, it } from 'vitest';
import { treeRows } from '../testing/rows';
import { rowOp } from './change-log';
import { livingCutoff } from './living-state';
import { NotFoundError } from './errors';
import {
	PRIVATE_PLACEHOLDER_NAME,
	maskForScope,
	maskRows,
	omitForScope,
	opsTouchPrivate,
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

describe('opsTouchPrivate on a file', () => {
	/** Nobody here is living, so nobody is private. */
	function noPrivatePeople() {
		return treeRows({
			people: [{ id: 'gran', givenName: 'Gran', surname: 'Old' }],
			events: [
				{ id: 'b-gran', entityId: 'gran', type: 'BIRT', dateRaw: '1850', dateSortEnd: '1850-12-31' }
			],
			media: [{ id: 'owned', linkedTo: ['gran'] }, { id: 'loose' }]
		});
	}
	// Unlinking is the media bump plus the link going, which is what leaves the file editor-only.
	const detach = (rows: ReturnType<typeof noPrivatePeople>, id: string) => {
		const before = rows.mediaItems.find((m) => m.id === id)!;
		const link = rows.mediaLinks.find((l) => l.mediaId === id);
		return [
			rowOp('media_items', id, before, { ...before, version: before.version + 1 }),
			...(link ? [rowOp('media_links', link.id, link, null)] : [])
		];
	};

	it('treats detaching a file as editor-only in a tree with no private person', () => {
		const rows = noPrivatePeople();
		expect(privatePeople(rows, CUTOFF).size).toBe(0);
		// Otherwise a scoped snapshot that left the private person out would allow what the whole
		// tree refuses.
		expect(opsTouchPrivate(detach(rows, 'owned'), rows, CUTOFF)).toBe(true);
		expect(opsTouchPrivate(detach(rows, 'loose'), rows, CUTOFF)).toBe(true);
	});

	it('still allows an op that leaves a file owned', () => {
		const rows = noPrivatePeople();
		const before = rows.mediaItems.find((m) => m.id === 'owned')!;
		const rename = rowOp('media_items', 'owned', before, { ...before, title: 'New' });
		expect(opsTouchPrivate([rename], rows, CUTOFF)).toBe(false);
	});
});

describe('maskRows on objects (ADR-082)', () => {
	/** Gran is visible, Liv is living; each object below hangs off one or both of them. */
	function withObjects() {
		const r = rows();
		const objects = treeRows({
			objects: [
				{ id: 'plain' },
				{ id: 'hushed', privacy: 'private' },
				{ id: 'open', privacy: 'public' },
				{ id: 'loose' }
			],
			media: [
				{ id: 'plain', objectId: 'plain', linkedTo: ['gran'] },
				{ id: 'plain-2', objectId: 'plain' },
				{ id: 'hushed', objectId: 'hushed', linkedTo: ['gran'] },
				{ id: 'open', objectId: 'open', linkedTo: ['liv'], factLinkedTo: [['gran', 'b-gran']] },
				{ id: 'loose', objectId: 'loose' }
			]
		});
		return {
			...r,
			mediaObjects: objects.mediaObjects,
			mediaItems: objects.mediaItems,
			mediaLinks: objects.mediaLinks
		};
	}
	const seen = (snapshot: ReturnType<typeof withObjects>) => {
		const out = maskRows(snapshot, CUTOFF, false).rows;
		return {
			objects: out.mediaObjects.map((o) => o.id),
			files: out.mediaItems.map((m) => m.id),
			links: out.mediaLinks.map((l) => l.id)
		};
	};

	it('hides a private object from a restricted viewer even though its owner is visible', () => {
		expect(seen(withObjects()).objects).not.toContain('hushed');
		expect(seen(withObjects()).files).not.toContain('hushed');
	});

	it('does not let a public object past a private person', () => {
		// "open" is public but one of its links is Liv, who is living.
		expect(seen(withObjects()).objects).not.toContain('open');
	});

	it('shows a secondary file exactly when its object is shown', () => {
		expect(seen(withObjects()).files).toEqual(expect.arrayContaining(['plain', 'plain-2']));
	});

	it('hides a detached object from a restricted viewer', () => {
		expect(seen(withObjects()).objects).not.toContain('loose');
		expect(seen(withObjects()).files).not.toContain('loose');
	});

	it('judges a fact link by the fact’s owner', () => {
		const snapshot = withObjects();
		// Take Liv away from "open"; its remaining link is a fact of Gran, who is visible.
		snapshot.mediaLinks = snapshot.mediaLinks.filter((l) => l.id !== 'open:liv');
		expect(seen(snapshot).objects).toContain('open');
		// A fact link of the living person hides it.
		snapshot.mediaLinks.push({
			...snapshot.mediaLinks[0]!,
			id: 'open:liv:b-liv',
			mediaId: 'open',
			entityId: 'liv',
			factId: 'b-liv'
		});
		expect(seen(snapshot).objects).not.toContain('open');
	});

	it('hands a role that sees everyone every object', () => {
		const snapshot = withObjects();
		const all = maskForScope(snapshot, scopeOf({ isRestricted: false })).rows;
		expect(all.mediaObjects).toHaveLength(snapshot.mediaObjects.length);
	});
});

describe('opsTouchPrivate on an object', () => {
	const build = () =>
		treeRows({
			people: [{ id: 'gran', givenName: 'Gran', surname: 'Old' }],
			events: [
				{ id: 'b-gran', entityId: 'gran', type: 'BIRT', dateRaw: '1850', dateSortEnd: '1850-12-31' }
			],
			objects: [{ id: 'plain' }, { id: 'hushed', privacy: 'private' }],
			media: [
				{ id: 'plain', objectId: 'plain', linkedTo: ['gran'] },
				{ id: 'hushed', objectId: 'hushed', linkedTo: ['gran'] }
			]
		});

	it('refuses an edit of a private object’s links, which a restricted viewer cannot see', () => {
		const snapshot = build();
		const link = snapshot.mediaLinks.find((l) => l.mediaId === 'hushed')!;
		expect(opsTouchPrivate([rowOp('media_links', link.id, link, null)], snapshot, CUTOFF)).toBe(
			true
		);
	});

	it('refuses making an object private, and allows a plain edit of a plain one', () => {
		const snapshot = build();
		const plain = snapshot.mediaObjects.find((o) => o.id === 'plain')!;
		expect(
			opsTouchPrivate(
				[rowOp('media_object', 'plain', plain, { ...plain, privacy: 'private' })],
				snapshot,
				CUTOFF
			)
		).toBe(true);
		expect(
			opsTouchPrivate(
				[rowOp('media_object', 'plain', plain, { ...plain, version: 2 })],
				snapshot,
				CUTOFF
			)
		).toBe(false);
	});
});
