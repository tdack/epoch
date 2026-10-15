import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTE } from '#lib/shared/palette.js';
import { MAX_TRACE_ITEMS, type KinSource } from '#lib/tree-layout/highlight.js';
import { layoutRings } from '#lib/tree-layout/rings.js';
import { makeGraph } from '#lib/tree-layout/test-support.js';
import { createHighlightState } from './webgl-highlight.svelte.js';

const GRAPH = makeGraph({
	people: ['G1', 'G2', 'A', 'B', 'SA', 'SB', 'K1', 'K2', 'C', 'Loner'],
	unions: [
		{ id: 'ug', partners: ['G1', 'G2'], children: ['A', 'B'] },
		{ id: 'ua', partners: ['A', 'SA'], children: ['K1'] },
		{ id: 'ub', partners: ['B', 'SB'], children: ['K2'] },
		{ id: 'uc', partners: ['K1', 'K2'], children: ['C'] }
	]
});
const layoutOf = (): KinSource =>
	layoutRings(GRAPH, 'C', { ancestorDepth: 6, descendantDepth: 6, collateralDepth: 2 });

/** The inputs are getters over variables, as the component passes them. */
function setup(focus: string | null = 'C') {
	let kin = layoutOf();
	const state = createHighlightState({
		kin: () => kin,
		focusPersonId: () => focus,
		palette: () => DEFAULT_PALETTE
	});
	return { state, newLayout: () => (kin = layoutOf()), kin: () => kin };
}

describe('createHighlightState', () => {
	it('lights the focus line by default', () => {
		const { state } = setup();
		expect(state.isCleared).toBe(false);
		expect(state.highlight.people.has('C')).toBe(true);
		expect(state.highlight.people.has('Loner')).toBe(false);
	});

	it('lights nothing for the whole tree, which has no focus', () => {
		const { state } = setup(null);
		expect(state.highlight.people.size).toBe(0);
	});

	it('goes quiet when cleared, until the layout changes', () => {
		const { state, newLayout } = setup();
		state.clearHighlight();
		expect(state.isCleared).toBe(true);
		expect(state.highlight.people.size).toBe(0);
		newLayout();
		expect(state.isCleared).toBe(false);
		expect(state.highlight.people.has('C')).toBe(true);
	});

	it('drops a selection made on an earlier layout', () => {
		const { state, newLayout } = setup();
		state.select({ kind: 'person', personId: 'A' });
		expect(state.activeSelection).toEqual({ kind: 'person', personId: 'A' });
		newLayout();
		expect(state.activeSelection).toBeNull();
	});

	it('sets the notice when the trace is full, and holds the items', () => {
		const { state, kin } = setup();
		const ids = kin().people.map((p) => p.id);
		expect(ids.length).toBeGreaterThan(MAX_TRACE_ITEMS);
		state.setTracing(true);
		for (const id of ids.slice(0, MAX_TRACE_ITEMS))
			state.toggleTrace({ kind: 'person', personId: id });
		expect(state.liveTrace).toHaveLength(MAX_TRACE_ITEMS);
		expect(state.notice).toBeNull();
		state.toggleTrace({ kind: 'person', personId: ids[MAX_TRACE_ITEMS] });
		expect(state.notice).toContain(`at most ${MAX_TRACE_ITEMS}`);
		expect(state.liveTrace).toHaveLength(MAX_TRACE_ITEMS);
	});

	it('empties the trace and the notice when tracing stops', () => {
		const { state } = setup();
		state.setTracing(true);
		state.toggleTrace({ kind: 'person', personId: 'A' });
		expect(state.liveTrace).toHaveLength(1);
		state.setTracing(false);
		expect(state.isTracing).toBe(false);
		expect(state.liveTrace).toHaveLength(0);
		expect(state.notice).toBeNull();
	});
});
