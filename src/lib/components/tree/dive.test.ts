import { describe, expect, it } from 'vitest';
import { layoutLayers } from '#lib/tree-layout/layers.js';
import { makeGraph } from '#lib/tree-layout/test-support.js';
import {
	DiveIntent,
	currentFamily,
	familyLabel,
	parentFamilies,
	reconcileTrail,
	wheelZoomLog2,
	type DiveTarget,
	type TrailEntry
} from './dive';

const OPTIONS = { ancestorDepth: 2, descendantDepth: 2, shouldIncludePartnerOrigins: true };

// A and B partner; A's parents are PA1+PA2, B's are PB1+PB2. C is their child; D was born to PD
// alone, with no partnership recorded.
const graph = makeGraph({
	people: ['PA1', 'PA2', 'PB1', 'PB2', 'A', 'B', 'C', 'PD', 'D'],
	unions: [
		{ id: 'UA', partners: ['PA1', 'PA2'], children: ['A'] },
		{ id: 'UB', partners: ['PB1', 'PB2'], children: ['B'] },
		{ id: 'U', partners: ['A', 'B'], children: ['C'] }
	],
	direct: [{ parentId: 'PD', childId: 'D' }]
});

describe('parentFamilies', () => {
	it("lists each partner's parents in partner order, landing on the parents' partnership", () => {
		const targets = parentFamilies(layoutLayers(graph, 'A', 'U', OPTIONS));
		expect(targets.map((t) => [t.focusId, t.unionId, t.childId, t.label])).toEqual([
			['PA1', 'UA', 'A', 'PA1 & PA2'],
			['PB1', 'UB', 'B', 'PB1 & PB2']
		]);
		expect(targets.every((t) => t.at.generation === -1)).toBe(true);
	});

	it('follows the union order, not who the focus is', () => {
		const targets = parentFamilies(layoutLayers(graph, 'B', 'U', OPTIONS));
		expect(targets.map((t) => t.unionId)).toEqual(['UA', 'UB']);
	});

	it('dives to a lone parent when no partnership was recorded', () => {
		const targets = parentFamilies(layoutLayers(graph, 'D', null, OPTIONS));
		expect(targets).toEqual([
			expect.objectContaining({ focusId: 'PD', unionId: null, label: 'PD' })
		]);
	});

	it('has nowhere to go when no parents are drawn', () => {
		expect(parentFamilies(layoutLayers(graph, 'PA1', 'UA', OPTIONS))).toEqual([]);
		expect(parentFamilies(layoutLayers(graph, 'A', 'U', { ancestorDepth: 0 }))).toEqual([]);
	});
});

describe('currentFamily', () => {
	it('names the focus partnership, or the person alone', () => {
		expect(currentFamily(layoutLayers(graph, 'A', 'U', OPTIONS))).toEqual({
			focusId: 'A',
			unionId: 'U',
			label: 'A & B'
		});
		expect(currentFamily(layoutLayers(graph, 'D', null, OPTIONS))?.label).toBe('D');
	});
});

describe('familyLabel', () => {
	it('joins names and covers a family with none', () => {
		expect(familyLabel(['Ann', '', 'Bo'])).toBe('Ann & Bo');
		expect(familyLabel([])).toBe('Unnamed family');
	});
});

describe('reconcileTrail', () => {
	const entry = (focusId: string): TrailEntry => ({ focusId, unionId: null, label: focusId });
	const target = { focusId: 'P', unionId: 'UP' } as DiveTarget;

	it('pushes the family a dive left once it lands', () => {
		expect(reconcileTrail([], 'P', { target, from: entry('C') })).toEqual([entry('C')]);
	});

	it('drops a family surfaced back to, and everything after it', () => {
		const trail = [entry('C'), entry('P'), entry('G')];
		expect(reconcileTrail(trail, 'P', null)).toEqual([entry('C')]);
		expect(reconcileTrail(trail, 'C', null)).toEqual([]);
	});

	it('starts again after a jump elsewhere', () => {
		expect(reconcileTrail([entry('C')], 'X', null)).toEqual([]);
		expect(reconcileTrail([entry('C')], 'X', { target, from: entry('Q') })).toEqual([]);
	});
});

describe('wheelZoomLog2', () => {
	it("matches d3-zoom's wheel delta, positive for zooming in", () => {
		expect(wheelZoomLog2({ deltaY: -100, deltaMode: 0, ctrlKey: false })).toBeCloseTo(0.2);
		expect(wheelZoomLog2({ deltaY: 3, deltaMode: 1, ctrlKey: false })).toBeCloseTo(-0.15);
		expect(wheelZoomLog2({ deltaY: -10, deltaMode: 0, ctrlKey: true })).toBeCloseTo(0.2);
	});
});

describe('DiveIntent', () => {
	const options = { thresholdLog2: 1, quietMs: 150, decayMs: 300, holdMs: 100 };

	it('ignores the burst that reached the limit, then travels after a deliberate push', () => {
		const intent = new DiveIntent(options);
		let now = 0;
		// One burst every 16 ms: it zooms up to the limit, then its momentum keeps pushing.
		for (let i = 0; i < 5; i++) expect(intent.push((now += 16), 0.2, false)).toBeNull();
		for (let i = 0; i < 20; i++) expect(intent.push((now += 16), 0.2, true)).toBeNull();
		expect(intent.progressAt(now)).toBe(0);
		now += 400;
		expect(intent.push(now, 0.4, true)).toBeNull();
		expect(intent.progressAt(now)).toBeCloseTo(0.4);
		expect(intent.push((now += 50), 0.4, true)).toBeNull();
		expect(intent.push((now += 50), 0.4, true)).toBe('in');
		expect(intent.progressAt(now)).toBe(0);
	});

	it('drains a push that stops short', () => {
		const intent = new DiveIntent(options);
		intent.push(1000, 0.6, true);
		expect(intent.progressAt(1050)).toBeCloseTo(0.6);
		expect(intent.progressAt(1250)).toBeCloseTo(0.1);
		expect(intent.progressAt(2000)).toBe(0);
	});

	it('takes a push back when the wheel turns the other way', () => {
		const intent = new DiveIntent(options);
		intent.push(1000, -0.6, true);
		expect(intent.direction).toBe('out');
		intent.push(1010, 0.4, false);
		expect(intent.progressAt(1010)).toBeCloseTo(0.2);
	});

	it('starts over when the zoom leaves the limit', () => {
		const intent = new DiveIntent(options);
		intent.push(1000, 0.6, true);
		intent.push(1010, 0.3, false);
		expect(intent.progressAt(1010)).toBe(0);
	});
});
