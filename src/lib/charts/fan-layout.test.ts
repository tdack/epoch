import { describe, expect, it } from 'vitest';
import { FAN, layoutFan } from './fan-layout';
import type { ChartPerson } from '../shared/charts';

const person = (
	name: string,
	birth: string | null = null,
	death: string | null = null
): ChartPerson => ({ id: name, name, isPrivate: false, birth, death });
const ring = (g: number) => Array.from({ length: 2 ** g }, (_, k) => person(`g${g}-${k}`));
const full = (generations: number) => Array.from({ length: generations }, (_, g) => ring(g)).flat();

describe('the fan layout', () => {
	it('draws one segment per recorded ancestor and none for an empty slot', () => {
		const slots = [person('me'), person('dad'), null, person('gpa'), null, null, null];
		expect(layoutFan(slots, 3).segments.map((s) => [s.slot, s.generation])).toEqual([
			[0, 0],
			[1, 1],
			[3, 2]
		]);
	});

	it('sizes the canvas to the outer ring, centred at the bottom', () => {
		const layout = layoutFan(full(3), 3);
		const outer = FAN.centreRadius + 2 * FAN.ringWidth;
		expect(layout.width).toBe(2 * (outer + FAN.padding));
		expect(layout.centre).toEqual({ x: outer + FAN.padding, y: outer + FAN.padding });
		expect(layout.height).toBe(outer + 2 * FAN.padding);
	});

	it('puts a first parent on the left and a second on the right, labels inside the canvas', () => {
		const layout = layoutFan(full(3), 3);
		const at = (slot: number) => layout.segments.find((s) => s.slot === slot)!.label;
		expect(at(1).x).toBeLessThan(layout.centre.x);
		expect(at(2).x).toBeGreaterThan(layout.centre.x);
		// A person's parents sit in the wedge that person's own wedge spans: the first parent's mid angle is left of the second.
		expect(at(3).x).toBeLessThan(at(4).x);
		for (const s of layout.segments) {
			expect(s.label.x).toBeGreaterThanOrEqual(0);
			expect(s.label.x).toBeLessThanOrEqual(layout.width);
			expect(s.label.y).toBeGreaterThanOrEqual(0);
			expect(s.label.y).toBeLessThanOrEqual(layout.height);
		}
	});

	it('keeps outer text from reading upside down, running inward on the left and outward on the right', () => {
		const layout = layoutFan(full(5), 5);
		const outer = layout.segments.filter((s) => s.generation >= 3);
		expect(outer.length).toBe(8 + 16);
		for (const s of outer) {
			expect(Math.abs(s.label.rotate)).toBeLessThanOrEqual(90);
			if (s.label.x < layout.centre.x - 1) expect(s.label.rotate).toBeGreaterThanOrEqual(0);
			if (s.label.x > layout.centre.x + 1) expect(s.label.rotate).toBeLessThanOrEqual(0);
		}
	});

	it('shortens a name to the room its wedge has, and only dates inner rings', () => {
		const long = person('A very long name indeed, Esquire', '1850', '1920');
		const slots = [person('me'), long, null, long, null, null, null, long, ...Array(7).fill(null)];
		const layout = layoutFan(slots, 4);
		const bySlot = (n: number) => layout.segments.find((s) => s.slot === n)!;
		expect(bySlot(1).label.lines).toEqual(['A very long name…', '1850 – 1920']);
		expect(bySlot(7).label.lines).toHaveLength(1);
		expect(bySlot(7).label.lines[0]!.length).toBeLessThan(long.name.length);
		expect(bySlot(7).label.lines[0]).toMatch(/…$/);
	});

	it('makes closed, finite paths for the largest fan', () => {
		const layout = layoutFan(full(7), 7);
		expect(layout.segments).toHaveLength(127);
		for (const s of layout.segments) {
			expect(s.path).not.toMatch(/NaN|Infinity/);
			expect(s.path.endsWith('Z')).toBe(true);
		}
	});
});
