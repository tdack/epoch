import { describe, expect, it } from 'vitest';
import { buildIndex } from './graph-index.js';
import { layoutOrrery } from './orrery.js';
import { layoutPoincare } from './poincare.js';
import { layoutRibbons } from './ribbons.js';
import { layoutRings } from './rings.js';
import { CAPTURED_GRAPHS } from './test-support.js';
import { selectWholeTree } from './whole-tree.js';

/** The four WebGL layouts take a selection and a null focus, and draw every person once. */
describe('the WebGL layouts draw the whole tree', () => {
	for (const { name, graph } of CAPTURED_GRAPHS) {
		it(`on ${name}`, () => {
			const selection = selectWholeTree(graph);
			const index = buildIndex(graph);
			const layouts = {
				rings: layoutRings(graph, null, {}, index, selection),
				poincare: layoutPoincare(graph, null, {}, index, selection),
				ribbons: layoutRibbons(graph, null, {}, index, 'sweep', selection),
				orrery: layoutOrrery(graph, null, {}, index, {}, selection)
			};
			for (const [view, layout] of Object.entries(layouts)) {
				expect(layout.focusPersonId, view).toBeNull();
				expect(layout.people.map((p) => p.id).sort(), view).toEqual(
					graph.people.map((p) => p.id).sort()
				);
				expect(JSON.stringify(layout), view).not.toMatch(/NaN|null,null/);
			}
			// Deterministic, the Orrery's simulation included.
			expect(layoutOrrery(graph, null, {}, index, {}, selection)).toEqual(layouts.orrery);
		});
	}

	it('still returns the empty layout with neither a focus nor a selection', () => {
		const { graph } = CAPTURED_GRAPHS[0];
		expect(layoutRings(graph, null).people).toEqual([]);
		expect(layoutOrrery(graph, undefined).people).toEqual([]);
	});

	it('draws an empty tree without throwing', () => {
		const empty = { people: [], unions: [], parentChild: [] };
		const selection = selectWholeTree(empty);
		expect(layoutOrrery(empty, null, {}, undefined, {}, selection).people).toEqual([]);
		expect(layoutRings(empty, null, {}, undefined, selection).people).toEqual([]);
	});
});
