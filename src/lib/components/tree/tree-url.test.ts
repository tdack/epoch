import { describe, it, expect } from 'vitest';
import {
	compactStubId,
	createHistoryCoalescer,
	DEFAULT_VIEW_STATE,
	HISTORY_COALESCE_MS,
	parseViewState,
	resolveStubTokens,
	serializeViewState
} from './tree-url';

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

describe('opened stubs in the URL', () => {
	const personId = '1a2b3c4d-1111-2222-3333-444455556666';
	const unionId = '9f8e7d6c-aaaa-bbbb-cccc-ddddeeeeffff';

	it('compacts each kind of stub id to a short token and back', () => {
		expect(compactStubId(`stub:ancestors:${personId}`)).toMatch(/^a\.[0-9a-z]{1,7}$/);
		expect(compactStubId(`stub:children:${unionId}`)).toMatch(/^u\.[0-9a-z]{1,7}$/);
		expect(compactStubId(`stub:children:direct:${personId}`)).toMatch(/^d\./);
		expect(compactStubId(`stub:children:other:${personId}`)).toMatch(/^o\./);
		// Ids that share a long prefix (as ids in one tree do) still get different tokens.
		expect(compactStubId('stub:ancestors:tree-1:@I1@')).not.toBe(compactStubId('stub:ancestors:tree-1:@I2@'));
		expect(compactStubId('something else')).toBeNull();
		const tokens = [compactStubId(`stub:ancestors:${personId}`)!, compactStubId(`stub:children:${unionId}`)!];
		expect(resolveStubTokens(tokens, [personId], [unionId]).sort()).toEqual(
			[`stub:ancestors:${personId}`, `stub:children:${unionId}`].sort()
		);
	});

	it('round-trips through the query string and drops malformed tokens', () => {
		const state = { ...DEFAULT_VIEW_STATE, expandedStubs: ['a.1a2b3c4d', 'u.9f8e7d6c'] };
		expect(serializeViewState(state).get('exp')).toBe('a.1a2b3c4d,u.9f8e7d6c');
		expect(parseViewState(serializeViewState(state)).expandedStubs).toEqual(state.expandedStubs);
		expect(parseViewState(new URLSearchParams('exp=a.ok,zz,../../x,u.9f8e7d6c')).expandedStubs).toEqual(['a.ok', 'u.9f8e7d6c']);
		expect(serializeViewState(DEFAULT_VIEW_STATE).has('exp')).toBe(false);
	});

	it('ignores tokens for stubs that no longer exist', () => {
		expect(resolveStubTokens(['a.deadbeef'], [personId], [unionId])).toEqual([]);
	});
});

describe('history coalescing', () => {
	it('always pushes a change of focus', () => {
		const coalescer = createHistoryCoalescer(() => 0);
		expect(coalescer.shouldReplace('focus')).toBe(false);
		expect(coalescer.shouldReplace('focus')).toBe(false);
	});

	it('pushes the first adjustment, then replaces while clicks keep coming', () => {
		let clock = 1000;
		const coalescer = createHistoryCoalescer(() => clock);
		expect(coalescer.shouldReplace('adjust')).toBe(false);
		clock += 300;
		expect(coalescer.shouldReplace('adjust')).toBe(true);
		clock += 300;
		expect(coalescer.shouldReplace('adjust')).toBe(true);
	});

	it('starts a new entry after a pause, and after a change of focus', () => {
		let clock = 1000;
		const coalescer = createHistoryCoalescer(() => clock);
		coalescer.shouldReplace('adjust');
		clock += HISTORY_COALESCE_MS + 1;
		expect(coalescer.shouldReplace('adjust')).toBe(false);
		clock += 100;
		coalescer.shouldReplace('focus');
		clock += 100;
		expect(coalescer.shouldReplace('adjust')).toBe(false);
	});
});
