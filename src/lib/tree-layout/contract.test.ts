import { describe, it, expect } from 'vitest';
import {
	allContractViolations,
	countCrossings,
	findCentringViolations,
	findDuplicatePeople,
	findEdgeViolations,
	findMissingPartners,
	findOverlaps,
	findPartnerViolations,
	findRowViolations,
	findStackedEdges
} from './contract';
import { EMPTY_LAYOUT, LAYOUT_METRICS, type ChildEdge, type TreeLayout } from './types';
import { layoutFocusView } from './index';
import { makeGraph } from './test-support';

const { cardWidth: W, rowHeight: H } = LAYOUT_METRICS;

/** A couple with one child, laid out correctly. */
function goodLayout(): TreeLayout {
	const person = (id: string, x: number, generation: number) => ({
		id,
		x,
		y: generation * H,
		generation,
		role: 'ancestor' as const,
		person: {
			id,
			displayName: id,
			sex: 'U' as const,
			isDeceased: false,
			parentsByUnion: {},
			unionIds: [],
			stepParents: []
		}
	});
	const gap = W + LAYOUT_METRICS.partnerGap;
	const union = {
		id: 'u',
		x: gap / 2,
		y: -H,
		generation: -1,
		isHanging: false,
		union: {
			id: 'u',
			status: 'active' as const,
			marriageDate: null,
			marriagePlace: null,
			partnerIds: ['a', 'b'],
			children: []
		}
	};
	const edge = (kind: 'partner', personId: string, x: number) => ({
		id: `partner:u:${personId}`,
		kind,
		unionId: 'u',
		personId,
		source: { x, y: -H },
		target: { x: gap / 2, y: -H }
	});
	const childEdge: ChildEdge = {
		id: 'child:u:c',
		kind: 'child',
		unionId: 'u',
		childId: 'c',
		assertions: [
			{ parentId: 'a', type: 'biological' },
			{ parentId: 'b', type: 'biological' }
		],
		types: ['biological'],
		isSecondaryPath: false,
		source: { x: gap / 2, y: -H },
		target: { x: gap / 2, y: 0 }
	};
	return {
		...EMPTY_LAYOUT,
		focusPersonId: 'c',
		people: [
			person('a', 0, -1),
			person('b', gap, -1),
			{ ...person('c', gap / 2, 0), role: 'focus' }
		],
		unions: [union],
		edges: [edge('partner', 'a', 0), edge('partner', 'b', gap), childEdge]
	};
}

const graph = makeGraph({
	people: ['a', 'b', 'c'],
	unions: [{ id: 'u', partners: ['a', 'b'], children: ['c'] }]
});

describe('contract checkers', () => {
	it('accept a compliant layout', () => {
		const layout = goodLayout();
		expect(findDuplicatePeople(layout)).toEqual([]);
		expect(findOverlaps(layout)).toEqual([]);
		expect(findMissingPartners(graph, layout)).toEqual([]);
		expect(findPartnerViolations(layout)).toEqual([]);
		expect(findEdgeViolations(graph, layout)).toEqual([]);
		expect(findCentringViolations(layout)).toEqual([]);
		expect(findRowViolations(layout)).toEqual([]);
		expect(countCrossings(layout)).toBe(0);
	});

	it('detect overlapping cards', () => {
		const layout = goodLayout();
		layout.people[1] = { ...layout.people[1], x: W / 2 };
		expect(findOverlaps(layout).length).toBeGreaterThan(0);
	});

	it('detect overlapping union nodes', () => {
		const layout = goodLayout();
		layout.unions.push({ ...layout.unions[0], id: 'u2', x: layout.unions[0].x + 5 });
		expect(findOverlaps(layout)).toContain('union u overlaps union u2');
	});

	it('detect edges stacked on the same two points', () => {
		const layout = goodLayout();
		const twin = {
			...layout.edges[2],
			id: 'twin',
			source: layout.edges[2].target,
			target: layout.edges[2].source
		};
		layout.edges.push(twin);
		expect(findStackedEdges(layout)).toEqual(['edges child:u:c and twin are stacked']);
		expect(findStackedEdges(goodLayout())).toEqual([]);
	});

	it('detect a duplicated person', () => {
		const layout = goodLayout();
		layout.people.push({ ...layout.people[0] });
		expect(findDuplicatePeople(layout)).toHaveLength(1);
	});

	it('detect a union drawn without a partner', () => {
		const layout = goodLayout();
		layout.people = layout.people.filter((p) => p.id !== 'b');
		expect(findMissingPartners(graph, layout)).toEqual(['union u is drawn without partner b']);
	});

	it('detect partners on different rows and a union outside them', () => {
		const layout = goodLayout();
		layout.people[1] = { ...layout.people[1], y: 0, generation: 0 };
		expect(findPartnerViolations(layout)).toEqual(['union u partners are on different rows']);

		const moved = goodLayout();
		moved.unions[0] = { ...moved.unions[0], x: -50 };
		expect(findPartnerViolations(moved)).toContain('union u is not between its partners');
	});

	it('detect a card wedged between partners', () => {
		const layout = goodLayout();
		layout.people.push({ ...layout.people[0], id: 'z', x: layout.unions[0].x - 5 });
		expect(findPartnerViolations(layout).some((v) => v.includes('separated by z'))).toBe(true);
	});

	it('skip adjacency for unions the layout reports as non-adjacent', () => {
		const layout = goodLayout();
		layout.people[1] = { ...layout.people[1], x: W * 4 };
		layout.nonAdjacentUnionIds = ['u'];
		expect(findPartnerViolations(layout)).toEqual([]);
	});

	it('detect duplicate and missing edges', () => {
		const layout = goodLayout();
		layout.edges.push({ ...(layout.edges[2] as ChildEdge), id: 'dup' });
		expect(findEdgeViolations(graph, layout)).toEqual(['edge u|c is drawn 2 times']);

		const missing = goodLayout();
		missing.edges = missing.edges.filter((e) => e.kind !== 'child');
		expect(findEdgeViolations(graph, missing)).toEqual(['edge u|c is missing']);
	});

	it('detect children that are off-centre or split by an outsider', () => {
		const layout = goodLayout();
		layout.people[2] = { ...layout.people[2], x: 400 };
		expect(findCentringViolations(layout)).toEqual(['children of u are not centred under it']);
	});

	it('detect an unrelated card between siblings', () => {
		const layout = goodLayout();
		const sibling = { ...layout.people[2], id: 'c2', x: layout.people[2].x + 3 * W };
		const outsider = {
			...layout.people[2],
			id: 'z',
			x: layout.people[2].x + 1.5 * W,
			role: 'ancestor' as const
		};
		layout.people.push(sibling, outsider);
		layout.edges.push({
			...(layout.edges[2] as ChildEdge),
			id: 'child:u:c2',
			childId: 'c2',
			target: { x: sibling.x, y: 0 }
		});
		expect(findCentringViolations(layout)).toContain('z sits between the children of u');
	});

	it('count crossings of edges that do not share an endpoint', () => {
		const layout = goodLayout();
		const mk = (id: string, sx: number, tx: number): ChildEdge => ({
			...(layout.edges[2] as ChildEdge),
			id,
			source: { x: sx, y: 0 },
			target: { x: tx, y: 100 }
		});
		layout.edges = [mk('e1', 0, 100), mk('e2', 100, 0), mk('e3', 200, 300)];
		expect(countCrossings(layout)).toBe(1);
	});
});

describe('step-children hang from their anchor parent in flat', () => {
	// K is the adoptive child of F and R (union uf) and the biological child of P and Q (union u2).
	// P is also F's partner, so u2 is drawn as P's other family. uf comes first in the chain, so
	// first come would hang K from F's union; the anchor is the biological parent P.
	const graph = makeGraph({
		people: ['F', 'R', 'P', 'Q', 'K'],
		unions: [
			{ id: 'uf', partners: ['F', 'R'], children: [{ id: 'K', type: 'adoptive' }] },
			{ id: 'uf2', partners: ['F', 'P'] },
			{ id: 'u2', partners: ['P', 'Q'], children: ['K'] }
		]
	});

	it('draws the anchor’s edge as the tree edge and the other as the dashed extra link', () => {
		const layout = layoutFocusView(graph, 'F', { shouldIncludeStepFamilies: true });
		const edges = layout.edges.filter(
			(e): e is ChildEdge => e.kind === 'child' && e.childId === 'K'
		);
		expect(edges.map((e) => [e.unionId, e.isSecondaryPath]).sort()).toEqual([
			['u2', false],
			['uf', true]
		]);
		expect(allContractViolations(graph, layout)).toEqual([]);
		expect(layout.misplacedPersonIds).toEqual([]);
	});
});
