import { describe, expect, it } from 'vitest';
import { layoutFloors } from '#lib/tree-layout/floors.js';
import { layoutLayers } from '#lib/tree-layout/layers.js';
import { LAYOUT_METRICS } from '#lib/tree-layout/index.js';
import { makeGraph } from '#lib/tree-layout/test-support.js';
import {
	BAND_ROW_PX,
	FLOOR_GAP_PX,
	LAYER_STAGGER_PX,
	LAYER_VIEWS,
	bandRowY,
	cameraTransform,
	connectorStyle,
	floorZ,
	framingLayout,
	layerCamera,
	layerOffset,
	layerPoint,
	layersFraming,
	planeScreenBox,
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
		expect(cameraTransform('floors')).toBe('rotateX(33deg) rotateY(0deg)');
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

describe('layers geometry', () => {
	it('puts each plane further back and staggers it across and up', () => {
		expect(layerOffset(0, 'angled')).toEqual({ x: 0, y: 0, z: 0 });
		expect(layerOffset(1, 'angled')).toEqual({
			x: LAYER_STAGGER_PX.x,
			y: -LAYER_STAGGER_PX.y,
			z: -200
		});
		expect(layerOffset(2, 'exploded').z).toBe(-760);
		// Pulling the planes apart changes only their depth.
		expect(layerOffset(2, 'front').x).toBe(layerOffset(2, 'exploded').x);
	});

	it('never lets two cards of different planes overlap on screen', () => {
		const { cardWidth, cardHeight, rowHeight } = LAYOUT_METRICS;
		for (const [a, b] of [
			[0, 1],
			[1, 2],
			[0, 2]
		] as const) {
			for (let rowA = -4; rowA <= 4; rowA++) {
				for (let rowB = -4; rowB <= 4; rowB++) {
					const dy = layerPoint(b, rowB, 0, 'front').y - layerPoint(a, rowA, 0, 'front').y;
					const dx = layerPoint(b, rowB, 0, 'front').x - layerPoint(a, rowA, 0, 'front').x;
					// Same x in the plane is the worst case; the stagger must keep them apart in x or y.
					expect(
						Math.abs(dy) >= cardHeight || Math.abs(dx) >= cardWidth,
						`${a}/${rowA} ${b}/${rowB}`
					).toBe(true);
					expect(rowHeight).toBe(170);
				}
			}
		}
	});

	it('names a camera for every view', () => {
		for (const view of Object.values(LAYER_VIEWS)) {
			expect(cameraTransform(layerCamera(view))).toMatch(/^rotateX\(.+deg\) rotateY\(.+deg\)$/);
		}
	});

	it('turns about Y before tilting about X', () => {
		const point = { x: 100, y: 50, z: 0 };
		expect(projectToScreen(point, 0, 0)).toEqual({ x: 100, y: 50 });
		expect(projectToScreen(point, 0, 90).x).toBeCloseTo(0, 6);
		expect(projectToScreen({ x: 0, y: 0, z: 100 }, 0, 90).x).toBeCloseTo(100, 6);
	});

	it('frames what is shown and leaves hidden planes out', () => {
		const graph = makeGraph({
			people: ['dad', 'mum', 'me', 'wife', 'kid'],
			unions: [
				{ id: 'u1', partners: ['dad', 'mum'], children: ['me'] },
				{ id: 'u2', partners: ['me', 'wife'], children: ['kid'] }
			]
		});
		const layout = layoutLayers(graph, 'me', null);
		const all = layersFraming(layout, 'angled');
		const front = layersFraming(layout, 'angled', new Set([1]));
		expect(all.people.map((p) => p.id).sort()).toEqual(['dad', 'kid', 'me', 'mum', 'wife']);
		expect(front.people.map((p) => p.id).sort()).toEqual(['kid', 'me', 'wife']);
		expect(all.bounds.minY).toBeLessThan(front.bounds.minY);
		expect(layersFraming(layout, 'front', new Set([0, 1, 2])).people).toEqual([]);
	});
});

describe('planeScreenBox', () => {
	it('is the bounds shifted by the offset of the plane when the camera looks straight on', () => {
		const box = planeScreenBox(
			{ minX: 0, maxX: 100, minY: 10, maxY: 50 },
			{ x: 5, y: -2, z: 0 },
			0,
			0
		);
		expect(box).toEqual({ minX: 5, maxX: 105, minY: 8, maxY: 48 });
	});

	it('lifts a plane up the screen as it moves toward the viewer when the stage tips back', () => {
		const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
		const level = planeScreenBox(bounds, { x: 0, y: 0, z: 0 }, 50, 0);
		const raised = planeScreenBox(bounds, { x: 0, y: 0, z: 260 }, 50, 0);
		expect(raised.minY).toBeLessThan(level.minY);
	});
});
