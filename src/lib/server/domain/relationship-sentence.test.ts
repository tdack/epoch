import { describe, it, expect } from 'vitest';
import { describeRelationshipIntent, displayName } from './relationship-sentence';

const alex = { id: 'p-alex', givenName: 'Alex', surname: 'Walker' };
const sam = { id: 'p-sam', givenName: 'Sam', surname: 'Smith' };
const jordan = { id: 'p-jordan', givenName: 'Jordan', surname: 'Lee' };

describe('displayName', () => {
	it('combines given and surname', () => {
		expect(displayName(alex)).toBe('Alex Walker');
	});

	it('falls back to a single name', () => {
		expect(displayName({ id: 'x', givenName: 'Alex', surname: null })).toBe('Alex');
		expect(displayName({ id: 'x', givenName: null, surname: 'Walker' })).toBe('Walker');
		expect(displayName({ id: 'x', givenName: null, surname: null })).toBe('Unknown');
	});
});

describe('describeRelationshipIntent', () => {
	it('describes an adoptive mother', () => {
		const sentence = describeRelationshipIntent({
			kind: 'add_parent',
			child: sam,
			parent: alex,
			type: 'adoptive',
			role: 'mother',
			unionLabel: 'Alex Walker–Jordan Lee'
		});
		expect(sentence).toBe(
			"Alex Walker will be recorded as Sam Smith's adoptive mother in the Alex Walker–Jordan Lee family."
		);
	});

	it('describes a biological parent with a possessive apostrophe', () => {
		const sentence = describeRelationshipIntent({
			kind: 'add_parent',
			child: sam,
			parent: alex,
			type: 'biological',
			role: 'parent',
			unionLabel: null
		});
		expect(sentence).toBe("Alex Walker will be recorded as Sam Smith's biological parent.");
	});

	it('describes adding a child', () => {
		const sentence = describeRelationshipIntent({
			kind: 'add_child',
			parent: alex,
			child: sam,
			type: 'biological',
			unionLabel: 'Alex Walker–Jordan Lee'
		});
		expect(sentence).toBe(
			'Sam Smith will be recorded as Alex Walker\'s biological child in the Alex Walker–Jordan Lee family.'
		);
	});

	it('describes adding a partner', () => {
		const sentence = describeRelationshipIntent({
			kind: 'add_partner',
			person: alex,
			partner: jordan,
			unionLabel: null
		});
		expect(sentence).toBe("Jordan Lee will be recorded as Alex Walker's partner.");
	});

	it('describes a death with derived widowhood', () => {
		const sentence = describeRelationshipIntent({
			kind: 'record_death',
			person: alex,
			widowedPartners: [jordan]
		});
		expect(sentence).toBe('Alex Walker will be recorded as deceased. Jordan Lee will become widowed.');
	});

	it('describes ending a union', () => {
		const sentence = describeRelationshipIntent({
			kind: 'end_union',
			person: alex,
			unionLabel: 'Alex Walker–Jordan Lee'
		});
		expect(sentence).toBe('Alex Walker will no longer be part of the Alex Walker–Jordan Lee union.');
	});
});
