import { describe, expect, it } from 'vitest';
import { allContractViolations } from './contract.js';
import { layoutWholeTree } from './index.js';
import { allTestGraphs, makeGraph } from './test-support.js';
import { LAYOUT_METRICS } from './types.js';

const { cardWidth: W } = LAYOUT_METRICS;

/** Three families with no link between them, and two people with no relatives at all. */
const scattered = makeGraph({
	people: [
		'Ned',
		'Cat',
		'Robb',
		'Sansa',
		'Tywin',
		'Joanna',
		'Cersei',
		'Jaime',
		'Aerys',
		'Rhaella',
		'Dany',
		'Hodor',
		'Varys'
	],
	unions: [
		{ id: 'stark', partners: ['Ned', 'Cat'], children: ['Robb', 'Sansa'] },
		{ id: 'lannister', partners: ['Tywin', 'Joanna'], children: ['Cersei', 'Jaime'] },
		{ id: 'targaryen', partners: ['Aerys', 'Rhaella'], children: ['Dany'] }
	]
});

describe('the flat whole tree', () => {
	for (const { name, graph } of [...allTestGraphs(), { name: 'scattered', graph: scattered }]) {
		it(`${name}: draws everyone once and honours the contract`, () => {
			const layout = layoutWholeTree(graph);
			expect(layout.focusPersonId).toBeNull();
			expect(layout.people.map((p) => p.id).sort()).toEqual(
				graph.people
					.filter((p) => p.isPartial !== true)
					.map((p) => p.id)
					.sort()
			);
			expect(layout.misplacedPersonIds).toEqual([]);
			expect(allContractViolations(graph, layout)).toEqual([]);
			expect(layoutWholeTree(structuredClone(graph))).toEqual(layout);
		});
	}

	it('keeps unconnected families apart, the largest first', () => {
		const layout = layoutWholeTree(scattered);
		const xOf = (id: string) => layout.people.find((p) => p.id === id)!.x;
		const span = (ids: string[]) => [Math.min(...ids.map(xOf)), Math.max(...ids.map(xOf))];
		const stark = span(['Ned', 'Cat', 'Robb', 'Sansa']);
		const lannister = span(['Tywin', 'Joanna', 'Cersei', 'Jaime']);
		const targaryen = span(['Aerys', 'Rhaella', 'Dany']);
		// More than a card's width between families, so they never read as one.
		expect(lannister[0] - stark[1]).toBeGreaterThan(W);
		expect(targaryen[0] - lannister[1]).toBeGreaterThan(W);
		expect(xOf('Hodor')).toBeGreaterThan(targaryen[1]);
	});

	it('hangs a married-in partner beside their spouse, under the spouse’s parents', () => {
		const graph = makeGraph({
			people: ['Hoster', 'Minisa', 'Cat', 'Ned', 'Rickard', 'Lyarra', 'Robb'],
			unions: [
				{ id: 'tully', partners: ['Hoster', 'Minisa'], children: ['Cat'] },
				{ id: 'rl', partners: ['Rickard', 'Lyarra'], children: ['Ned'] },
				{ id: 'nc', partners: ['Ned', 'Cat'], children: ['Robb'] }
			]
		});
		const layout = layoutWholeTree(graph);
		expect(allContractViolations(graph, layout)).toEqual([]);
		const row = (id: string) => layout.people.find((p) => p.id === id)!.generation;
		expect(row('Ned')).toBe(row('Cat'));
		expect(row('Robb')).toBe(row('Ned') + 1);
		expect(layout.nonAdjacentUnionIds).toEqual([]);
	});

	it('draws an empty tree as the empty layout', () => {
		expect(layoutWholeTree({ people: [], unions: [], parentChild: [] }).people).toEqual([]);
	});
});
