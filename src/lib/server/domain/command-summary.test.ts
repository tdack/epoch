import { describe, expect, it } from 'vitest';
import { describeGroupFact } from './command-summary';
import { treeRows } from '../testing/rows';

describe('describeGroupFact', () => {
	const rows = treeRows({ people: [{ id: 'a', givenName: 'Ann', surname: 'Hill' }, { id: 'b' }] });

	it('names a group of one, as a single added fact does', () => {
		expect(describeGroupFact(rows, 'DEAT', ['a'])).toBe('Added death to Ann Hill');
	});

	it('counts a larger group', () => {
		expect(describeGroupFact(rows, 'EMIG', ['a', 'b'])).toBe('Added emigration to 2 people');
	});
});
