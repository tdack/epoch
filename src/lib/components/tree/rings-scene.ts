/**
 * The WebGL side of the rings overview (ADR-032): a three.js scene drawn from a `RingsLayout`, with
 * orbit controls and picking. `RingsCanvas.svelte` imports this module dynamically, so three.js is
 * fetched only by someone who opens Rings, and the component keeps the DOM (names, controls).
 */

import {
	CanvasTexture,
	CircleGeometry,
	CubicBezierCurve3,
	DoubleSide,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	SphereGeometry,
	SRGBColorSpace,
	Sprite,
	SpriteMaterial,
	TorusGeometry,
	Vector3
} from 'three';
import { linkKey, type Highlight, type Mark } from '#lib/tree-layout/highlight.js';
import type { RingsLayout } from '#lib/tree-layout/rings.js';
import { createThreeStage, sexColour } from './three-stage.js';
import { HIGHLIGHT_TOKENS, RING_FADE, RING_LINE_WIDTH_PX, RING_TOKENS } from './tree-tokens.js';
import type { WebGlTreeScene } from './webgl-tree.js';
import { RING_CAMERAS } from './webgl-cameras.js';

/** Vertical distance between two generation rings, in scene units; wider rings spread further. */
export const RING_GAP_UNITS = 6.5;
/** A ring's radius as a share of the gap the whole tree's widest ring asks for. */
const GAP_PER_RADIUS = 0.1;
const SPHERE_RADIUS_UNITS = 0.34;
const FOCUS_SCALE = 1.45;
/** How far above its partners the knot sits that a partnership's lines to its children leave from. */
const UNION_LIFT_UNITS = 0.45;
/** A generation's disc reaches this far past the circle its people stand on, as a multiple. */
const DISC_OVERHANG = 1.12;
/** The invisible hit sphere on a partnership knot, as a multiple of a person's sphere. */
const UNION_HIT_SCALE = 1.3;
/** The knot of a partnership that is the selection itself. */
const SELF_KNOT_SCALE = 1.5;
/** A halo sprite's width as a multiple of the sphere radius it surrounds. */
const HALO_WIDTH_SCALE = 4.1;
const TAU = Math.PI * 2;
const RING_MIN_FRAME_UNITS = 3;

/** Direction from the target to the camera for each preset; the distance comes from the layout. */
const CAMERA_DIRECTIONS = {
	[RING_CAMERAS.ANGLED]: new Vector3(0.62, 0.42, 0.62),
	[RING_CAMERAS.SIDE]: new Vector3(0, 0.05, 1),
	// Straight down the trunk turns the rings into concentric circles, a fan chart for free.
	[RING_CAMERAS.ABOVE]: new Vector3(0.001, 1, 0.001)
};

export interface RingsScene extends WebGlTreeScene {
	/** Rebuild everything from a new layout. `shouldRefit` also resets the camera distance. */
	setLayout(layout: RingsLayout, highlight: Highlight, shouldRefit: boolean): void;
}

/**
 * The gap between rings. A focus view's rings are small and keep the fixed gap; the whole tree's
 * widest ring can be hundreds of units across, and rings that close would read as one slab.
 */
function ringGap(layout: RingsLayout): number {
	const widest = Math.max(0, ...layout.rings.map((r) => r.radius));
	return Math.max(RING_GAP_UNITS, widest * GAP_PER_RADIUS);
}

/** Height of a generation's ring: the youngest at the top, the most distant ancestors at the bottom. */
function ringHeight(generation: number, gap: number): number {
	return generation * gap;
}

function ringPosition(generation: number, radius: number, angle: number, gap: number): Vector3 {
	return new Vector3(
		Math.cos(angle) * radius,
		ringHeight(generation, gap),
		Math.sin(angle) * radius
	);
}

/**
 * The highlight colours are tuned for the cream stage, where the focus line's brown and purple read.
 * On the dark stage the same hues are lifted, so a mark's colour still says which line it is.
 */
const LIFTED = new Map<string, string>([
	[HIGHLIGHT_TOKENS.focus.ancestor, RING_TOKENS.dark.ancestor],
	[HIGHLIGHT_TOKENS.focus.descendant, RING_TOKENS.dark.descendant],
	[HIGHLIGHT_TOKENS.focus.partner, RING_TOKENS.dark.partner]
]);
function onDark(colour: string): string {
	return LIFTED.get(colour) ?? colour;
}

/** Circles drawn once, so a halo is a tinted camera-facing sprite that reads from every angle. */
function haloTexture(radii: number[]): CanvasTexture {
	const size = 128;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const context = canvas.getContext('2d')!;
	context.strokeStyle = '#ffffff';
	context.lineWidth = size * 0.05;
	for (const radius of radii) {
		context.beginPath();
		context.arc(size / 2, size / 2, size * radius, 0, TAU);
		context.stroke();
	}
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	return texture;
}

/**
 * @throws when the browser cannot give a WebGL context; the shell shows a message instead.
 */
export function createRingsScene(host: HTMLElement): RingsScene {
	const stage = createThreeStage(host, {
		background: RING_TOKENS.dark.stage,
		cameraDirections: CAMERA_DIRECTIONS
	});

	const sphere = stage.share(new SphereGeometry(SPHERE_RADIUS_UNITS, 24, 16));
	const knot = stage.share(new TorusGeometry(0.16, 0.05, 8, 20));
	/** Hit target for a partnership's marker: bigger than a person's sphere, though the knot is small. */
	const unionHit = stage.share(new SphereGeometry(SPHERE_RADIUS_UNITS * UNION_HIT_SCALE, 8, 6));
	const singleHalo = haloTexture([0.36]);
	const doubleHalo = haloTexture([0.33, 0.47]);

	function setLayout(layout: RingsLayout, highlight: Highlight, shouldRefit: boolean) {
		// No highlight (the viewer cleared it): everyone is drawn plainly, nobody faded.
		const isQuiet = highlight.isQuiet;
		const privateIds = new Set(
			layout.people.filter((p) => p.person.isPrivate === true).map((p) => p.id)
		);
		const isPrivate = (id: string) => privateIds.has(id);
		const gap = ringGap(layout);
		const personById = new Map(layout.people.map((p) => [p.id, p]));
		/** A mark's opacity: the soft half of a path is lighter, and everything off it fades. */
		const opacityOf = (mark: Mark | undefined) =>
			mark
				? mark.strength === 'soft'
					? HIGHLIGHT_TOKENS.softOpacity
					: 1
				: isQuiet
					? 1
					: RING_FADE.line;
		const colourOf = (mark: Mark | undefined) =>
			mark ? onDark(mark.colour) : RING_TOKENS.dark.line;
		const widthOf = (mark: Mark | undefined) =>
			mark
				? mark.isShared
					? RING_LINE_WIDTH_PX.shared
					: RING_LINE_WIDTH_PX.lit
				: RING_LINE_WIDTH_PX.unlit;
		/** The person (or line) the viewer chose, as opposed to what is on its path. */
		const isChosenPerson = (mark: Mark | undefined) =>
			mark?.kind === 'self' && highlight.sources[mark.sourceIndexes[0]]?.source.kind !== 'union';
		const world = stage.resetWorld();
		const positions = new Map<string, Vector3>();

		/** A ring round `at` in the mark's colour, doubled where two or more paths meet. */
		const addHalo = (mark: Mark, at: Vector3, radius: number) => {
			const halo = new Sprite(
				new SpriteMaterial({
					map: mark.isShared ? doubleHalo : singleHalo,
					color: onDark(mark.colour),
					transparent: true,
					opacity: opacityOf(mark),
					depthWrite: false
				})
			);
			halo.scale.setScalar(radius * HALO_WIDTH_SCALE);
			halo.position.copy(at);
			world.add(halo);
		};

		// Equal looks share a material: a whole tree has thousands of spheres and few distinct looks.
		const spheres = new Map<string, MeshStandardMaterial>();
		const sphereMaterial = (colour: string, opacity: number) => {
			const key = `${colour}|${opacity}`;
			let material = spheres.get(key);
			if (!material) {
				material = new MeshStandardMaterial({
					color: colour,
					roughness: 0.55,
					metalness: 0.05,
					transparent: opacity < 1,
					opacity
				});
				spheres.set(key, material);
			}
			return material;
		};

		// Each generation stands on a see-through disc a little wider than its circle of people.
		for (const ring of layout.rings) {
			const discRadius = ring.radius * DISC_OVERHANG;
			const disc = new Mesh(
				new CircleGeometry(discRadius, 96),
				new MeshBasicMaterial({
					color: RING_TOKENS.dark.disc,
					transparent: true,
					opacity: RING_FADE.disc,
					side: DoubleSide,
					depthWrite: false
				})
			);
			disc.rotation.x = -Math.PI / 2;
			disc.position.y = ringHeight(ring.generation, gap);
			world.add(disc);
			const rim: Vector3[] = [];
			for (let i = 0; i <= 128; i++)
				rim.push(ringPosition(ring.generation, discRadius, (i / 128) * TAU, gap));
			world.add(stage.hairline(rim, RING_TOKENS.dark.rim, RING_FADE.rim));
		}

		for (const p of layout.people) {
			const position = ringPosition(p.generation, p.radius, p.angle, gap);
			const mark = highlight.people.get(p.id);
			const opacity = mark ? 1 : isQuiet ? 1 : RING_FADE.person;
			// Their sex fill stays; the mark shows as a halo round it.
			const mesh = new Mesh(sphere, sphereMaterial(sexColour(p.person), opacity));
			mesh.position.copy(position);
			const scale = isChosenPerson(mark) ? FOCUS_SCALE : 1;
			mesh.scale.setScalar(scale);
			if (mark) addHalo(mark, position, SPHERE_RADIUS_UNITS * scale);
			world.add(mesh);
			stage.track(p.id, position, isPrivate(p.id) ? null : mesh);
			positions.set(p.id, position);
		}

		const unionAt = new Map<string, Vector3>();
		for (const u of layout.unions) {
			const at = ringPosition(u.generation, u.radius, u.angle, gap).add(
				new Vector3(0, UNION_LIFT_UNITS, 0)
			);
			unionAt.set(u.id, at);
			const mark = highlight.unions.get(u.id);
			if (u.partnerIds.length > 1) {
				// The partnership arc follows the ring the short way round between its first two partners.
				const [a, b] = u.partnerIds.map((id) => personById.get(id)!);
				let to = b.angle;
				if (to - a.angle > Math.PI) to -= TAU;
				if (a.angle - to > Math.PI) to += TAU;
				const points: Vector3[] = [];
				for (let i = 0; i <= 12; i++)
					points.push(
						ringPosition(a.generation, a.radius, a.angle + ((to - a.angle) * i) / 12, gap)
					);
				world.add(stage.thickLine(points, colourOf(mark), opacityOf(mark), widthOf(mark)));
			}
			const marker = new Mesh(
				knot,
				new MeshStandardMaterial({
					color: colourOf(mark),
					transparent: opacityOf(mark) < 1,
					opacity: opacityOf(mark)
				})
			);
			marker.position.copy(at);
			marker.rotation.x = Math.PI / 2;
			if (mark?.kind === 'self') marker.scale.setScalar(SELF_KNOT_SCALE);
			world.add(marker);
			if (mark) addHalo(mark, at, 0.3);
			// The knot is too small to hit, so an invisible sphere bigger than a person's stands in for it.
			const hit = new Mesh(unionHit, new MeshBasicMaterial({ visible: false }));
			hit.position.copy(at);
			world.add(hit);
			stage.trackUnion(u.id, at, u.partnerIds.some(isPrivate) ? null : hit);
		}

		for (const link of layout.childLinks) {
			const from =
				link.fromUnionId !== null
					? unionAt.get(link.fromUnionId)
					: positions.get(link.fromPersonId!);
			const to = positions.get(link.childId);
			if (!from || !to) continue;
			const key = linkKey(link);
			const mark = highlight.links.get(key);
			const rise = (to.y - from.y) / 2;
			const curve = new CubicBezierCurve3(
				from,
				from.clone().add(new Vector3(0, rise, 0)),
				to.clone().add(new Vector3(0, -rise, 0)),
				to
			);
			const line = stage.thickLine(
				curve.getPoints(24),
				colourOf(mark),
				opacityOf(mark),
				widthOf(mark)
			);
			world.add(line);
			const isHidden = isPrivate(link.childId) || link.parentIds.some(isPrivate);
			stage.trackLink(key, curve.getPoint(0.5), isHidden ? null : line);
		}

		// Frames every ring, not just the focus person's: the outline of the top and bottom rings
		// must fit, aimed at the middle of the stack.
		const ys = layout.rings.map((r) => ringHeight(r.generation, gap));
		const top = ys.length > 0 ? Math.max(...ys) : 0;
		const bottom = ys.length > 0 ? Math.min(...ys) : 0;
		const radius = Math.max(
			RING_MIN_FRAME_UNITS,
			...layout.rings.map((r) => r.radius * DISC_OVERHANG)
		);
		const outline: Vector3[] = [];
		for (const y of [top, bottom])
			for (let i = 0; i < 16; i++) {
				const a = (i / 16) * TAU;
				outline.push(new Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
			}
		stage.frame(outline, new Vector3(0, (top + bottom) / 2, 0), shouldRefit);
	}

	return {
		...stage.handle,
		setLayout,
		dispose() {
			singleHalo.dispose();
			doubleHalo.dispose();
			stage.handle.dispose();
		}
	};
}
