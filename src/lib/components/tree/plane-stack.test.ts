import { describe, expect, it } from 'vitest';
import { layoutFloors } from '#lib/tree-layout/floors.js';
import { makeGraph } from '#lib/tree-layout/test-support.js';
import {
	BAND_ROW_PX,
	FLOOR_GAP_PX,
	bandRowY,
	cameraTransform,
	connectorStyle,
	floorZ,
	framingLayout,
	projectToScreen
} from './plane-stack';

/** Where the connector's far end lands when its transform is applied to (0, length, 0). */
function farEnd(style: ReturnType<typeof connectorStyle>) {
	const match = style.transform.match(
		/translate3d\(([-\d.e]+)px, ([-\d.e]+)px, ([-\d.e]+)px\) rotateZ\(([-\d.e]+)rad\) rotateX\(([-\d.e]+)rad\)/
	)!;
	const [tx, ty, tz, yaw, pitch] = match.slice(1).map(Number);
	// rotateX(pitch) then rotateZ(yaw), as CSS applies the right-hand transform first.
	const y1 = style.length * Math.cos(pitch);
	const z1 = style.length * Math.sin(pitch);
	return {
		x: tx - y1 * Math.sin(yaw),
		y: ty + y1 * Math.cos(yaw),
		z: tz + z1
	};
}

describe('plane stack geometry', () => {
	it('puts the direct line at the front of a floor and each band a row behind it', () => {
		expect(bandRowY(0)).toBe(2 * BAND_ROW_PX);
		expect(bandRowY(1)).toBe(BAND_ROW_PX);
		expect(bandRowY(2)).toBe(0);
	});

	it('lifts older generations', () => {
		expect(floorZ(-1)).toBe(FLOOR_GAP_PX);
		expect(floorZ(0)).toBe(0);
		expect(floorZ(2)).toBe(-2 * FLOOR_GAP_PX);
		expect(projectToScreen({ x: 0, y: 0, z: floorZ(-1) }).y).toBeLessThan(
			projectToScreen({ x: 0, y: 0, z: floorZ(0) }).y
		);
	});

	it('keeps x and shortens y by the tilt', () => {
		expect(projectToScreen({ x: 40, y: 100, z: 0 }, 60)).toEqual({
			x: 40,
			y: expect.closeTo(50, 6)
		});
		expect(projectToScreen({ x: 3, y: 9, z: 0 }, 0)).toEqual({ x: 3, y: 9 });
	});

	it('writes the camera as a transform', () => {
		expect(cameraTransform('floors')).toBe('rotateX(50deg) rotateY(0deg)');
	});

	it('aims a connector from one point to the other in every direction', () => {
		const from = { x: 10, y: 20, z: 30 };
		for (const to of [
			{ x: 10, y: 20, z: 330 },
			{ x: 10, y: 120, z: 30 },
			{ x: -90, y: 20, z: 30 },
			{ x: 70, y: -60, z: -230 },
			{ x: -15, y: 80, z: 290 }
		]) {
			const style = connectorStyle(from, to);
			const end = farEnd(style);
			expect(end.x).toBeCloseTo(to.x, 6);
			expect(end.y).toBeCloseTo(to.y, 6);
			expect(end.z).toBeCloseTo(to.z, 6);
		}
	});
});

describe('framingLayout', () => {
	const graph = makeGraph({
		people: ['mum', 'dad', 'me', 'kid'],
		unions: [
			{ id: 'u1', partners: ['mum', 'dad'], children: ['me'] },
			{ id: 'u2', partners: ['me'], children: ['kid'] }
		]
	});

	it('frames every person, with ancestors higher on screen than descendants', () => {
		const framing = framingLayout(layoutFloors(graph, 'me'));
		const at = (id: string) => framing.people.find((p) => p.id === id)!;
		expect(framing.focusPersonId).toBe('me');
		expect(at('mum').y).toBeLessThan(at('me').y);
		expect(at('me').y).toBeLessThan(at('kid').y);
		for (const p of framing.people) {
			expect(p.x).toBeGreaterThanOrEqual(framing.bounds.minX);
			expect(p.x).toBeLessThanOrEqual(framing.bounds.maxX);
			expect(p.y).toBeGreaterThanOrEqual(framing.bounds.minY);
			expect(p.y).toBeLessThanOrEqual(framing.bounds.maxY);
		}
	});

	it('is empty for an empty layout', () => {
		expect(framingLayout(layoutFloors(graph, 'nobody')).people).toEqual([]);
	});
});
