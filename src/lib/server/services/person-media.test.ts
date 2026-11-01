import { describe, expect, it } from 'vitest';
import { treeRows } from '../testing/rows';
import { personMediaEntries, type PersonMediaInput } from './person-media';

const scope = { role: 'editor' as const, userId: 'u1' };

/** Builds the input from the shared row fixtures; `rid` follows the order the links were declared. */
function input(spec: Parameters<typeof treeRows>[0], overrides: Partial<PersonMediaInput> = {}) {
	const rows = treeRows(spec);
	return {
		files: rows.mediaItems,
		links: rows.mediaLinks.map((row, rid) => ({ rid, row })),
		facts: rows.events,
		objects: new Map(),
		linkedRecords: new Map(),
		uploaders: new Map(),
		scope,
		...overrides
	} satisfies PersonMediaInput;
}

const PERSON = { id: 'p1', givenName: 'Ada' };

describe('personMediaEntries', () => {
	it('lists one entry per pointer, record-level first and then each fact in the fact order', () => {
		const entries = personMediaEntries(
			input({
				people: [PERSON],
				events: [
					{ id: 'e-birth', entityId: 'p1', type: 'BIRT' },
					{ id: 'e-death', entityId: 'p1', type: 'DEAT' }
				],
				media: [
					{ id: 'm-death', factLinkedTo: [['p1', 'e-death']] },
					{ id: 'm-birth', factLinkedTo: [['p1', 'e-birth']] },
					{ id: 'm-plain', linkedTo: ['p1'] }
				]
			})
		);
		expect(entries.map((e) => [e.id, e.factLabel])).toEqual([
			['m-plain', null],
			['m-birth', 'Birth'],
			['m-death', 'Death']
		]);
		expect(entries[1]).toMatchObject({ factId: 'e-birth', objectId: 'm-birth' });
	});

	it('shows a photo on the person and on a fact once for each pointer', () => {
		const entries = personMediaEntries(
			input({
				people: [PERSON],
				events: [{ id: 'e1', entityId: 'p1', type: 'BIRT' }],
				media: [{ id: 'm1', linkedTo: ['p1'], factLinkedTo: [['p1', 'e1']] }]
			})
		);
		expect(entries.map((e) => e.factId)).toEqual([null, 'e1']);
	});

	it('orders by sort_order with null as 0, then by row position', () => {
		const rows = treeRows({
			people: [PERSON],
			media: [
				{ id: 'a', linkedTo: ['p1'] },
				{ id: 'b', linkedTo: ['p1'] },
				{ id: 'c', linkedTo: ['p1'] }
			]
		});
		rows.mediaLinks.find((l) => l.mediaId === 'a')!.sortOrder = 2;
		rows.mediaLinks.find((l) => l.mediaId === 'c')!.sortOrder = 0;
		const entries = personMediaEntries({
			...input({}),
			files: rows.mediaItems,
			links: rows.mediaLinks.map((row, rid) => ({ rid, row }))
		});
		// b and c both read as 0 and keep their declared order; a is last.
		expect(entries.map((e) => e.id)).toEqual(['b', 'c', 'a']);
	});

	it('puts an object’s other files in extraFiles, in order, and shows the pointer title', () => {
		const rows = treeRows({
			people: [PERSON],
			objects: [{ id: 'o1', version: 5 }],
			media: [
				{ id: 'f2', objectId: 'o1', sortOrder: 1, title: 'Back' },
				{ id: 'f1', objectId: 'o1', sortOrder: 0, title: 'Front', linkedTo: ['p1'] }
			]
		});
		rows.mediaLinks[0]!.title = 'Wedding';
		const [entry, ...others] = personMediaEntries({
			...input({}),
			files: rows.mediaItems,
			links: rows.mediaLinks.map((row, rid) => ({ rid, row })),
			objects: new Map([['o1', { version: 5 }]])
		});
		expect(others).toEqual([]);
		expect(entry).toMatchObject({
			id: 'f1',
			objectId: 'o1',
			objectVersion: 5,
			title: 'Front',
			linkTitle: 'Wedding'
		});
		expect(entry!.extraFiles.map((f) => f.id)).toEqual(['f2']);
	});

	it('never sends the placeholder key of an unresolved file, and keeps its path', () => {
		const [entry] = personMediaEntries(
			input({
				people: [PERSON],
				media: [
					{
						id: 'u1',
						linkedTo: ['p1'],
						status: 'unresolved',
						r2ObjectKey: 'unresolved/u1',
						gedcomPath: 'C:\\Photos\\ada.jpg'
					}
				]
			})
		);
		expect(entry).toMatchObject({
			isUnresolved: true,
			r2ObjectKey: null,
			gedcomPath: 'C:\\Photos\\ada.jpg'
		});
	});
});
