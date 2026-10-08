import { describe, expect, it } from 'vitest';
import { buildIndex } from './graph-index';
import { layoutOrrery } from './orrery';
import { selectFocusSubgraph } from './select';
import { allTestGraphs } from './test-support';

describe('layoutOrrery', () => {
	for (const { name, graph } of allTestGraphs()) {
		it(`${name}: draws exactly the people the selection draws, once each`, () => {
			const index = buildIndex(graph);
			const focus = graph.people[0];
			const layout = layoutOrrery(graph, focus.id, {}, index);
			const selection = selectFocusSubgraph(graph, focus.id, {}, index)!;
			const ids = layout.people.map((p) => p.id);
			expect(new Set(ids).size).toBe(ids.length);
			expect(new Set(ids)).toEqual(new Set(selection.people.map((p) => p.id)));
		});
	}

	it('is empty without a focus person', () => {
		const { graph } = allTestGraphs()[0];
		expect(layoutOrrery(graph, null).people).toEqual([]);
		expect(layoutOrrery(graph, 'no-such-person').people).toEqual([]);
	});
});
