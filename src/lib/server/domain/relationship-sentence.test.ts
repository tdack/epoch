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

	it('describes a death with its date and place', () => {
		const sentence = describeRelationshipIntent({
			kind: 'record_death',
			person: alex,
			dateText: '3 MAR 2001',
			place: 'Brisbane'
		});
		expect(sentence).toBe('Alex Walker will be recorded as deceased (3 MAR 2001, Brisbane).');
	});

	it('names each derived widowhood without guessing a pronoun', () => {
		const sentence = describeRelationshipIntent(
			{ kind: 'record_death', person: alex, dateText: null, place: null },
			{ widowed: [{ widow: jordan, deceased: alex }] }
		);
		expect(sentence).toBe(
			'Alex Walker will be recorded as deceased. Jordan Lee will be shown as widowed in their partnership with Alex Walker.'
		);
	});

	it('does not repeat a widowhood that two duplicate unions imply', () => {
		const widowed = { widow: jordan, deceased: alex };
		const sentence = describeRelationshipIntent(
			{ kind: 'record_death', person: alex, dateText: null, place: null },
			{ widowed: [widowed, widowed] }
		);
		expect(sentence.match(/widowed/g)).toHaveLength(1);
	});

	it('describes ending a partnership with its status and dated event', () => {
		const sentence = describeRelationshipIntent(
			{
				kind: 'end_union',
				person: alex,
				unionId: 'u1',
				status: 'divorced',
				event: { type: 'DIV', dateText: '12 MAR 1999', place: null }
			},
			{ partners: [alex, jordan] }
		);
		expect(sentence).toBe(
			'The partnership between Alex Walker and Jordan Lee will be recorded as divorced (12 MAR 1999).'
		);
	});

	it('takes the family from the resolved facts rather than the client label', () => {
		const sentence = describeRelationshipIntent(
			{ kind: 'add_child', parent: alex, child: jordan, type: 'biological', unionLabel: 'client says so' },
			{ unionLabel: 'Alex Walker–Sam Smith' }
		);
		expect(sentence).toBe("Jordan Lee will be recorded as Alex Walker's biological child in the Alex Walker–Sam Smith family.");
	});
});
