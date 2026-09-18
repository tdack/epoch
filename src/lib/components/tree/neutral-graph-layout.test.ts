import { describe, it, expect } from 'vitest';
import { buildNeutralGraphLayout, selectFocusedGraph } from './neutral-graph-layout';
import type { RelationshipGraph } from '#lib/server/domain/relationship-graph.js';

function graph(): RelationshipGraph {
	return {
		people: [
			{
				id: 'p1',
				displayName: 'Alex Walker',
				isDeceased: false,
				parentsByUnion: {},
				unionIds: ['u1'],
				stepParents: []
			},
			{
				id: 'p2',
				displayName: 'Bob Smith',
				isDeceased: false,
				parentsByUnion: {},
				unionIds: ['u1'],
				stepParents: []
			},
			{
				id: 'c1',
				displayName: 'Sam Walker',
				isDeceased: false,
				parentsByUnion: {},
				unionIds: [],
				stepParents: []
			}
		],
		unions: [{ id: 'u1', status: 'active', partnerIds: ['p1', 'p2'], children: [{ childId: 'c1', parentId: 'p1', type: 'biological' }] }],
		parentChild: [{ parentId: 'p1', childId: 'c1', type: 'biological', unionId: 'u1' }]
	};
}

describe('buildNeutralGraphLayout', () => {
	it('lays out people, union, and links', () => {
		const layout = buildNeutralGraphLayout(graph());

		expect(layout.people).toHaveLength(3);
		expect(layout.unions).toHaveLength(1);
		// Partner links + one child link.
		expect(layout.links.filter((l) => l.type === 'partner')).toHaveLength(2);
		expect(layout.links.filter((l) => l.type === 'parent_child')).toHaveLength(1);
	});

	it('places children one generation below parents', () => {
		const layout = buildNeutralGraphLayout(graph());
		const child = layout.people.find((p) => p.id === 'c1')!;
		const parent = layout.people.find((p) => p.id === 'p1')!;
		expect(child.y).toBeGreaterThan(parent.y);
	});

	it('keeps repeated unions as distinct union nodes', () => {
		const g = graph();
		g.unions.push({ id: 'u2', status: 'active', partnerIds: ['p1', 'p2'], children: [] });
		const layout = buildNeutralGraphLayout(g);
		expect(layout.unions).toHaveLength(2);
		expect(layout.unions.map((u) => u.id)).toEqual(['u1', 'u2']);
	});

	it('handles a single-parent union without crashing', () => {
		const g = graph();
		g.unions = [{ id: 'u1', status: 'active', partnerIds: ['p1'], children: [{ childId: 'c1', parentId: 'p1', type: 'biological' }] }];
		const layout = buildNeutralGraphLayout(g);
		expect(layout.unions).toHaveLength(1);
		expect(layout.links.filter((l) => l.type === 'partner')).toHaveLength(1);
	});

	it('centres the focus person at the origin', () => {
		const g = graph();
		const layout = buildNeutralGraphLayout(g, { focusPersonId: 'c1' });
		expect(layout.focusPersonId).toBe('c1');
		const focus = layout.people.find((p) => p.id === 'c1')!;
		expect(focus.x).toBe(0);
		expect(focus.y).toBe(0);
	});

	it('places ancestors above and descendants below the focus person', () => {
		const g = graph();
		const layout = buildNeutralGraphLayout(g, { focusPersonId: 'c1' });
		const parent = layout.people.find((p) => p.id === 'p1')!;
		const child = layout.people.find((p) => p.id === 'c1')!;
		expect(parent.y).toBeLessThan(child.y);
	});
});

describe('selectFocusedGraph', () => {
	it('selects the subgraph around the focus person within depth limits', () => {
		const g = graph();
		// Add a grandparent chain to verify ancestor depth.
		g.people.push({ id: 'gp', displayName: 'Grand Parent', isDeceased: false, parentsByUnion: {}, unionIds: [], stepParents: [] });
		g.parentChild.push({ parentId: 'gp', childId: 'p1', type: 'biological', unionId: null });

		const focused = selectFocusedGraph(g, 'c1', { ancestorDepth: 2, descendantDepth: 2 });
		// c1 + its parent p1 + grandparent gp; p2 is not reachable from c1.
		expect(focused.people.map((p) => p.id).sort()).toEqual(['c1', 'gp', 'p1']);
	});
});
