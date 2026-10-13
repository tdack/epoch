import { describe, it, expect } from 'vitest';
import {
	compactStubId,
	createHistoryCoalescer,
	DEFAULT_VIEW_STATE,
	HISTORY_COALESCE_MS,
	parseViewState,
	resolveStubTokens,
	serializeViewState,
	shouldResetStubs,
	wideGroupDefaults
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
		expect(params.toString()).toBe(
			'tree=t1&focus=p9&up=5&down=0&siblings=0&step=1&types=biological%2Cadoptive&mode=flat'
		);
		expect(parseViewState(params)).toEqual(state);
	});

	it('carries the layout mode, flat included, and falls back to the default of the viewer without one', () => {
		const rings = {
			...DEFAULT_VIEW_STATE,
			treeId: 't1',
			focusId: 'p1',
			layoutMode: 'rings' as const,
			...wideGroupDefaults('rings')
		};
		expect(serializeViewState(rings).toString()).toBe('tree=t1&focus=p1&mode=rings');
		expect(parseViewState(serializeViewState(rings)).layoutMode).toBe('rings');
		expect(parseViewState(new URLSearchParams('mode=orrery')).layoutMode).toBe('orrery');
		expect(parseViewState(new URLSearchParams('mode=flat')).layoutMode).toBe('flat');
		expect(parseViewState(new URLSearchParams('mode=sideways')).layoutMode).toBe('flat');
		// A link without a mode opens in the reader's default; the address wins over it.
		expect(parseViewState(new URLSearchParams(''), 'rings').layoutMode).toBe('rings');
		expect(parseViewState(new URLSearchParams('mode=flat'), 'rings').layoutMode).toBe('flat');
		expect(parseViewState(new URLSearchParams('mode=sideways'), 'rings').layoutMode).toBe('rings');
		// A removed view (ADR-047) in an old link opens the reader's default instead.
		for (const removed of ['floors', 'layers'])
			expect(parseViewState(new URLSearchParams(`mode=${removed}`), 'rings').layoutMode).toBe(
				'rings'
			);
		// Flat is written too, so a reload cannot be flipped by a default that says otherwise.
		expect(serializeViewState({ ...DEFAULT_VIEW_STATE, layoutMode: 'flat' }).get('mode')).toBe(
			'flat'
		);
	});

	it('keeps the whole tree in every view', () => {
		for (const mode of ['flat', 'rings', 'orrery']) {
			const parsed = parseViewState(new URLSearchParams(`mode=${mode}&scope=all`));
			expect(parsed.isWholeTree, mode).toBe(true);
			expect(serializeViewState(parsed).get('scope'), mode).toBe('all');
		}
		expect(serializeViewState(DEFAULT_VIEW_STATE).has('scope')).toBe(false);
	});

	it('carries the wider groups, and leaves their defaults out', () => {
		const wide = {
			...DEFAULT_VIEW_STATE,
			treeId: 't1',
			focusId: 'p1',
			collateralDepth: 2,
			shouldIncludePartnerOrigins: true
		};
		expect(serializeViewState(wide).toString()).toBe('tree=t1&focus=p1&side=2&origins=1&mode=flat');
		expect(parseViewState(serializeViewState(wide))).toEqual(wide);
		expect(parseViewState(new URLSearchParams('side=7')).collateralDepth).toBe(2);
		expect(parseViewState(new URLSearchParams('side=x&origins=maybe'))).toMatchObject({
			collateralDepth: 0,
			shouldIncludePartnerOrigins: false
		});
		const flat = serializeViewState({ ...DEFAULT_VIEW_STATE, treeId: 't1', focusId: 'p1' });
		expect(flat.has('side') || flat.has('origins')).toBe(false);
	});

	it('opens a WebGL view with the wider groups on, straight from the address', () => {
		const rings = parseViewState(new URLSearchParams('mode=rings'));
		expect(rings).toMatchObject({ collateralDepth: 2, shouldIncludePartnerOrigins: true });
		// A link with no mode that falls back to Rings gets the same, so the first render is right.
		expect(parseViewState(new URLSearchParams(''), 'rings')).toMatchObject({
			collateralDepth: 2,
			shouldIncludePartnerOrigins: true
		});
		expect(parseViewState(new URLSearchParams('mode=flat'), 'rings')).toMatchObject({
			collateralDepth: 0,
			shouldIncludePartnerOrigins: false
		});
		// What the address says wins over the view's defaults.
		expect(parseViewState(new URLSearchParams('mode=rings&side=1&origins=0'))).toMatchObject({
			collateralDepth: 1,
			shouldIncludePartnerOrigins: false
		});
	});

	it('writes out a WebGL view with the wider groups turned off, so it survives a reload', () => {
		const off = {
			...DEFAULT_VIEW_STATE,
			layoutMode: 'rings' as const,
			collateralDepth: 0,
			shouldIncludePartnerOrigins: false
		};
		const params = serializeViewState(off);
		expect(params.get('side')).toBe('0');
		expect(params.get('origins')).toBe('0');
		expect(parseViewState(params)).toEqual(off);
		const defaults = { ...off, collateralDepth: 2, shouldIncludePartnerOrigins: true };
		expect(serializeViewState(defaults).toString()).toBe('mode=rings');
		expect(parseViewState(serializeViewState(defaults))).toEqual(defaults);
	});

	it('omits defaults', () => {
		expect(
			serializeViewState({ ...DEFAULT_VIEW_STATE, treeId: 't1', focusId: 'p1' }).toString()
		).toBe('tree=t1&focus=p1&mode=flat');
	});

	it('falls back to defaults for junk input', () => {
		const parsed = parseViewState(
			new URLSearchParams('up=-3&down=abc&siblings=maybe&types=nope&focus=')
		);
		expect(parsed).toEqual(DEFAULT_VIEW_STATE);
	});

	it('caps depth so a hand-edited link cannot ask for an enormous tree', () => {
		expect(parseViewState(new URLSearchParams('up=999')).ancestorDepth).toBe(8);
	});
});

describe('the open drawer in the URL', () => {
	it('parses the person the drawer is open on', () => {
		expect(parseViewState(new URLSearchParams('focus=p1&person=p2')).personId).toBe('p2');
	});

	it('treats a missing or empty person as a closed drawer', () => {
		expect(parseViewState(new URLSearchParams('focus=p1')).personId).toBeNull();
		expect(parseViewState(new URLSearchParams('focus=p1&person=')).personId).toBeNull();
	});

	it('serialises the person beside the focus', () => {
		const state = { ...DEFAULT_VIEW_STATE, treeId: 't1', focusId: 'p1', personId: 'p2' };
		const params = serializeViewState(state);
		expect(params.toString()).toBe('tree=t1&focus=p1&person=p2&mode=flat');
		expect(parseViewState(params)).toEqual(state);
	});

	it('omits the person when the drawer is closed', () => {
		const params = serializeViewState({ ...DEFAULT_VIEW_STATE, focusId: 'p1', personId: null });
		expect(params.has('person')).toBe(false);
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
		expect(compactStubId('stub:ancestors:tree-1:@I1@')).not.toBe(
			compactStubId('stub:ancestors:tree-1:@I2@')
		);
		expect(compactStubId('something else')).toBeNull();
		const tokens = [
			compactStubId(`stub:ancestors:${personId}`)!,
			compactStubId(`stub:children:${unionId}`)!
		];
		expect(resolveStubTokens(tokens, [personId], [unionId]).sort()).toEqual(
			[`stub:ancestors:${personId}`, `stub:children:${unionId}`].sort()
		);
	});

	it('round-trips through the query string and drops malformed tokens', () => {
		const state = { ...DEFAULT_VIEW_STATE, expandedStubs: ['a.1a2b3c4d', 'u.9f8e7d6c'] };
		expect(serializeViewState(state).get('exp')).toBe('a.1a2b3c4d,u.9f8e7d6c');
		expect(parseViewState(serializeViewState(state)).expandedStubs).toEqual(state.expandedStubs);
		expect(
			parseViewState(new URLSearchParams('exp=a.ok,zz,../../x,u.9f8e7d6c')).expandedStubs
		).toEqual(['a.ok', 'u.9f8e7d6c']);
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

describe('when a change closes the opened stubs', () => {
	it('closes them only when the focus person changes', () => {
		expect(shouldResetStubs({ focusId: 'p2' }, 'p1')).toBe(true);
		expect(shouldResetStubs({ focusId: 'p2', personId: 'p2' }, 'p1')).toBe(true);
		expect(shouldResetStubs({ focusId: 'p1', personId: 'p1' }, 'p1')).toBe(false);
		expect(shouldResetStubs({ ancestorDepth: 3 }, 'p1')).toBe(false);
		expect(shouldResetStubs({ personId: null }, 'p1')).toBe(false);
	});

	it('leaves stubs the change names itself alone', () => {
		expect(shouldResetStubs({ focusId: 'p2', expandedStubs: ['a'] }, 'p1')).toBe(false);
	});

	it('treats a first focus, when none was set, as a change', () => {
		expect(shouldResetStubs({ focusId: 'p1' }, null)).toBe(true);
	});
});
