import { describe, expect, it } from 'vitest';
import { selectWholeTree } from './whole-tree.js';
import { CAPTURED_GRAPHS, makeGraph, SYNTHETIC_GRAPHS } from './test-support.js';
import type { RelationshipGraph } from './types.js';

const rows = (graph: RelationshipGraph) =>
	new Map(selectWholeTree(graph).people.map((p) => [p.id, p.generation]));

describe('selectWholeTree', () => {
	it('has no focus and puts the oldest row at 0', () => {
		for (const { graph } of [...CAPTURED_GRAPHS, ...SYNTHETIC_GRAPHS]) {
			const selection = selectWholeTree(graph);
			expect(selection.focusPersonId).toBeNull();
			expect(selection.people).toHaveLength(graph.people.length);
			expect(Math.min(...selection.people.map((p) => p.generation))).toBe(0);
			expect(selection.people.some((p) => p.role === 'focus')).toBe(false);
			expect(selection.people.every((p) => p.band === 0)).toBe(true);
			expect(selection.stubs).toEqual([]);
			expect(selection.collapsedPersonIds).toEqual([]);
		}
	});

	it('puts a child one row below its lowest parent and partners on one row', () => {
		// Gran > Mum; Dad is Mum's partner and has no recorded parents; Kid is theirs. Dad's own
		// parent Great is above Gran's row only by being a root, so he must still share Mum's row.
		const graph = makeGraph({
			people: ['Gran', 'Mum', 'Dad', 'Kid', 'Great', 'Gran2'],
			unions: [
				{ id: 'g', partners: ['Gran', 'Gran2'], children: ['Mum'] },
				{ id: 'm', partners: ['Mum', 'Dad'], children: ['Kid'] }
			],
			direct: [{ parentId: 'Great', childId: 'Gran' }]
		});
		const r = rows(graph);
		expect(r.get('Great')).toBe(0);
		expect(r.get('Gran')).toBe(1);
		expect(r.get('Gran2')).toBe(1);
		expect(r.get('Mum')).toBe(2);
		expect(r.get('Dad')).toBe(2);
		expect(r.get('Kid')).toBe(3);
	});

	it('draws a child under the lowest of two parents of different depth', () => {
		const graph = makeGraph({
			people: ['Root', 'Mid', 'Spouse', 'Kid'],
			unions: [{ id: 'u', partners: ['Mid', 'Spouse'], children: ['Kid'] }],
			direct: [{ parentId: 'Root', childId: 'Mid' }]
		});
		const r = rows(graph);
		// Spouse shares Mid's row, so the partnership is one row down and Kid one below that.
		expect(r.get('Spouse')).toBe(r.get('Mid'));
		expect(r.get('Kid')).toBe(r.get('Mid')! + 1);
	});

	it('includes unconnected families, lined up by their dated members, else from row 0', () => {
		const graph = makeGraph({
			people: ['A', 'B', 'C', 'X', 'Y', 'Undated1', 'Undated2'],
			direct: [
				{ parentId: 'A', childId: 'B' },
				{ parentId: 'B', childId: 'C' },
				{ parentId: 'X', childId: 'Y' },
				{ parentId: 'Undated1', childId: 'Undated2' }
			]
		});
		const dates: Record<string, string> = {
			A: '1800',
			B: '1830',
			C: '1860',
			// X and Y are born in the era of B and C, so they belong a row below where they start.
			X: '1830',
			Y: '1860'
		};
		for (const p of graph.people) p.birthDate = dates[p.id] ?? null;
		const r = rows(graph);
		expect(r.size).toBe(7);
		expect(r.get('A')).toBe(0);
		expect(r.get('X')).toBe(r.get('B'));
		expect(r.get('Y')).toBe(r.get('C'));
		expect(r.get('Undated1')).toBe(0);
		expect(r.get('Undated2')).toBe(1);
	});

	it('never draws a person a bounded window only named', () => {
		const graph = makeGraph({
			people: ['A', 'B', 'K'],
			unions: [{ id: 'u', partners: ['A', 'B'], children: ['K'] }]
		});
		graph.people.find((p) => p.id === 'B')!.isPartial = true;
		const selection = selectWholeTree(graph);
		expect(selection.people.map((p) => p.id)).toEqual(['A', 'K']);
		expect(selection.unions.map((u) => u.id)).toEqual(['u']);
	});

	it('is deterministic and survives a parent loop', () => {
		const graph = makeGraph({
			people: ['A', 'B', 'C'],
			direct: [
				{ parentId: 'A', childId: 'B' },
				{ parentId: 'B', childId: 'A' },
				{ parentId: 'B', childId: 'C' }
			]
		});
		const first = selectWholeTree(graph);
		expect(selectWholeTree(graph)).toEqual(first);
		const r = rows(graph);
		// The earliest person in the loop is taken out of it; the rest hang below.
		expect(r.get('A')).toBe(0);
		expect(r.get('B')).toBe(1);
		expect(r.get('C')).toBe(2);
	});

	it('copes with the dirty fixture (partner loops, repeated unions)', () => {
		const dirty = CAPTURED_GRAPHS.find((g) => g.name === 'simpsons-dirty')!.graph;
		const selection = selectWholeTree(dirty);
		expect(selection.people).toHaveLength(dirty.people.length);
		const byId = new Map(selection.people.map((p) => [p.id, p.generation]));
		for (const union of dirty.unions) {
			const partnerRows = new Set(union.partnerIds.map((id) => byId.get(id)));
			expect(partnerRows.size).toBe(1);
		}
	});
});
