import { describe, expect, it } from 'vitest';
import { initialsOf } from './profile';

describe('initialsOf', () => {
	it('takes the first letters of the first two words', () => {
		expect(initialsOf('ada lovelace byron', 'a@x.test')).toBe('AL');
	});
	it('takes one letter from a one-word name', () => {
		expect(initialsOf('Ada', 'z@x.test')).toBe('A');
	});
	it('ignores extra whitespace', () => {
		expect(initialsOf('  grace \t  hopper  ', null)).toBe('GH');
	});
	it('falls back to the email for a null, empty or blank name', () => {
		for (const name of [null, undefined, '', '   ']) {
			expect(initialsOf(name, 'troy@dack.com.au')).toBe('T');
		}
	});
	it('is empty when there is neither', () => {
		expect(initialsOf(null, '')).toBe('');
		expect(initialsOf('', null)).toBe('');
	});
});
