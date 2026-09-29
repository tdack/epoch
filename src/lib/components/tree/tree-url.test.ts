import { describe, it, expect } from 'vitest';
import { DEFAULT_VIEW_STATE, parseViewState, serializeViewState } from './tree-url';

describe('tree view URL state', () => {
	it('round-trips a customised view', () => {
		const state = {
			...DEFAULT_VIEW_STATE,
			treeId: 't1',
			focusId: 'p9',
			ancestorDepth: 5,
			descendantDepth: 0,
			shouldIncludeSiblings: false,
			shouldIncludeStepFamilies: true,
			types: ['biological' as const, 'adoptive' as const]
		};
		const params = serializeViewState(state);
		expect(params.toString()).toBe('tree=t1&focus=p9&up=5&down=0&siblings=0&step=1&types=biological%2Cadoptive');
		expect(parseViewState(params)).toEqual(state);
	});

	it('omits defaults', () => {
		expect(serializeViewState({ ...DEFAULT_VIEW_STATE, treeId: 't1', focusId: 'p1' }).toString()).toBe('tree=t1&focus=p1');
	});

	it('falls back to defaults for junk input', () => {
		const parsed = parseViewState(new URLSearchParams('up=-3&down=abc&siblings=maybe&types=nope&focus='));
		expect(parsed).toEqual(DEFAULT_VIEW_STATE);
	});

	it('caps depth so a hand-edited link cannot ask for an enormous tree', () => {
		expect(parseViewState(new URLSearchParams('up=999')).ancestorDepth).toBe(8);
	});
});
