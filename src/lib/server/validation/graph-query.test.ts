import { describe, expect, it } from 'vitest';
import { ValidationError } from '../domain/errors';
import { compactStubId } from '../../shared/stub-tokens';
import { MAX_OPENED_STUBS, parseFocusQuery } from './graph-query';

const parse = (query: string) => parseFocusQuery(new URLSearchParams(query));

describe('parseFocusQuery', () => {
	it('reads the focus and leaves every option to the defaults when none is given', () => {
		expect(parse('focus=abc')).toEqual({ focusPersonId: 'abc', options: {} });
	});

	it('treats a request with no focus as the whole-tree aggregate', () => {
		expect(parse('').focusPersonId).toBeNull();
		expect(parse('focus=').focusPersonId).toBeNull();
	});

	it('reads the same names the page address uses', () => {
		const token = compactStubId('stub:ancestors:abc')!;
		expect(parse(`focus=a&up=2&down=0&siblings=0&step=1&exp=${token}`).options).toEqual({
			ancestorDepth: 2,
			descendantDepth: 0,
			shouldIncludeSiblings: false,
			shouldIncludeStepFamilies: true,
			expandedStubTokens: [token]
		});
	});

	it('caps depth at the most a view offers', () => {
		expect(parse('focus=a&up=99').options.ancestorDepth).toBe(8);
	});

	it('rejects values that are not whole numbers or flags, as a 400', () => {
		for (const bad of ['up=-1', 'up=x', 'down=1.5', 'siblings=yes', 'step=2']) {
			expect(() => parse(`focus=a&${bad}`), bad).toThrow(ValidationError);
		}
	});

	it('drops malformed stub tokens and refuses an unbounded list', () => {
		expect(parse('focus=a&exp=nonsense,x.1').options.expandedStubTokens).toBeUndefined();
		const many = Array.from({ length: MAX_OPENED_STUBS + 1 }, (_, i) => `a.${i}`).join(',');
		expect(() => parse(`focus=a&exp=${many}`)).toThrow(ValidationError);
	});
});
