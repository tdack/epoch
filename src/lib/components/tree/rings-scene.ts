/**
 * The WebGL side of the rings overview (ADR-032): a three.js scene drawn from a `RingsLayout`, with
 * orbit controls and picking. `RingsCanvas.svelte` imports this module dynamically, so three.js is
 * fetched only by someone who opens Rings, and the component keeps the DOM (names, controls).
 */

import {
	CircleGeometry,
	CubicBezierCurve3,
	DoubleSide,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	SphereGeometry,
	TorusGeometry,
	Vector3
} from 'three';
import { linkKey, type Highlight } from '#lib/tree-layout/highlight.js';
import type { RingsLayout } from '#lib/tree-layout/rings.js';
import { createThreeStage, sexColour } from './three-stage.js';
import { HIGHLIGHT_TOKENS, RING_FADE, RING_LINE_WIDTH_PX, RING_TOKENS } from './tree-tokens.js';
import { highlightRoles, type WebGlTreeScene } from './webgl-tree.js';

/** Vertical distance between two generation rings, in scene units. */
export const RING_GAP_UNITS = 6.5;
const SPHERE_RADIUS_UNITS = 0.34;
const FOCUS_SCALE = 1.45;
/** How far above its partners the knot sits that a partnership's lines to its children leave from. */
const UNION_LIFT_UNITS = 0.45;
/** A generation's disc reaches this far past the circle its people stand on, as a multiple. */
const DISC_OVERHANG = 1.12;
const TAU = Math.PI * 2;
const RING_MIN_FRAME_UNITS = 3;

export const RING_CAMERAS = { ANGLED: 'angled', SIDE: 'side', ABOVE: 'above' } as const;

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

/** Height of a generation's ring: the youngest at the top, the most distant ancestors at the bottom. */
function ringHeight(generation: number): number {
	return generation * RING_GAP_UNITS;
}

export function ringPosition(generation: number, radius: number, angle: number): Vector3 {
	return new Vector3(Math.cos(angle) * radius, ringHeight(generation), Math.sin(angle) * radius);
}

/**
 * @throws when the browser cannot give a WebGL context; the shell shows a message instead.
 */
export function createRingsScene(host: HTMLElement): RingsScene {
	const stage = createThreeStage(host, {
		background: RING_TOKENS.stage,
		cameraDirections: CAMERA_DIRECTIONS
	});

	const sphere = stage.share(new SphereGeometry(SPHERE_RADIUS_UNITS, 24, 16));
	const knot = stage.share(new TorusGeometry(0.16, 0.05, 8, 20));
	const halo = stage.share(
		new TorusGeometry(SPHERE_RADIUS_UNITS * FOCUS_SCALE * 1.45, 0.06, 8, 40)
	);

	/** Hit target for a partnership's marker: as big as a person's sphere, though the knot is small. */
	const unionHit = stage.share(new SphereGeometry(SPHERE_RADIUS_UNITS, 8, 6));

	function setLayout(layout: RingsLayout, highlight: Highlight, shouldRefit: boolean) {
		// No highlight (the viewer cleared it): everyone is drawn plainly, nobody faded.
		const isQuiet = highlight.isQuiet;
		const roles = highlightRoles(highlight);
		const isPrivate = (id: string) => privateIds.has(id);
		const privateIds = new Set(
			layout.people.filter((p) => p.person.isPrivate === true).map((p) => p.id)
		);
		/** A mark's opacity: the soft half of a path is lighter, and everything off it fades. */
		const opacityOf = (mark: { strength: 'full' | 'soft' } | undefined) =>
			mark
				? mark.strength === 'soft'
					? HIGHLIGHT_TOKENS.softOpacity
					: 1
				: isQuiet
					? 1
					: RING_FADE.line;
		const world = stage.resetWorld();
		const positions = new Map<string, Vector3>();

		// Each generation stands on a see-through disc a little wider than its circle of people.
		for (const ring of layout.rings) {
			const discRadius = ring.radius * DISC_OVERHANG;
			const disc = new Mesh(
				new CircleGeometry(discRadius, 96),
				new MeshBasicMaterial({
					color: RING_TOKENS.disc,
					transparent: true,
					opacity: RING_FADE.disc,
					side: DoubleSide,
					depthWrite: false
				})
			);
			disc.rotation.x = -Math.PI / 2;
			disc.position.y = ringHeight(ring.generation);
			world.add(disc);
			const rim: Vector3[] = [];
			for (let i = 0; i <= 128; i++)
				rim.push(ringPosition(ring.generation, discRadius, (i / 128) * TAU));
			world.add(stage.hairline(rim, RING_TOKENS.disc, RING_FADE.rim));
		}

		for (const p of layout.people) {
			const position = ringPosition(p.generation, p.radius, p.angle);
			const role = roles.get(p.id) ?? null;
			const mesh = new Mesh(
				sphere,
				new MeshStandardMaterial({
					color: sexColour(p.person),
					roughness: 0.55,
					metalness: 0.05,
					transparent: role === null && !isQuiet,
					opacity: role === null && !isQuiet ? RING_FADE.person : 1
				})
			);
			mesh.position.copy(position);
			if (role === 'focus') {
				mesh.scale.setScalar(FOCUS_SCALE);
				// Colour now says sex, so the focus is marked by size and a dark halo round it.
				const focusHalo = new Mesh(halo, new MeshBasicMaterial({ color: RING_TOKENS.focus }));
				focusHalo.position.copy(position);
				focusHalo.rotation.x = Math.PI / 2;
				world.add(focusHalo);
			}
			world.add(mesh);
			stage.track(p.id, position, isPrivate(p.id) ? null : mesh);
			positions.set(p.id, position);
		}

		const unionAt = new Map<string, Vector3>();
		for (const u of layout.unions) {
			const at = ringPosition(u.generation, u.radius, u.angle).add(
				new Vector3(0, UNION_LIFT_UNITS, 0)
			);
			unionAt.set(u.id, at);
			const mark = highlight.unions.get(u.id);
			const isLit = mark !== undefined;
			if (u.partnerIds.length > 1) {
				// The partnership arc follows the ring the short way round between its first two partners.
				const [a, b] = u.partnerIds.map((id) => layout.people.find((p) => p.id === id)!);
				let to = b.angle;
				if (to - a.angle > Math.PI) to -= TAU;
				if (a.angle - to > Math.PI) to += TAU;
				const points: Vector3[] = [];
				for (let i = 0; i <= 12; i++)
					points.push(ringPosition(a.generation, a.radius, a.angle + ((to - a.angle) * i) / 12));
				world.add(
					stage.thickLine(
						points,
						mark ? mark.colour : RING_TOKENS.line,
						opacityOf(mark),
						isLit ? RING_LINE_WIDTH_PX.lit : RING_LINE_WIDTH_PX.unlit
					)
				);
			}
			const marker = new Mesh(
				knot,
				new MeshStandardMaterial({
					color: mark ? mark.colour : RING_TOKENS.line,
					transparent: opacityOf(mark) < 1,
					opacity: opacityOf(mark)
				})
			);
			marker.position.copy(at);
			marker.rotation.x = Math.PI / 2;
			world.add(marker);
			// The knot is too small to hit, so an invisible sphere the size of a person stands in for it.
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
			const isLit = mark !== undefined;
			const rise = (to.y - from.y) / 2;
			const curve = new CubicBezierCurve3(
				from,
				from.clone().add(new Vector3(0, rise, 0)),
				to.clone().add(new Vector3(0, -rise, 0)),
				to
			);
			const line = stage.thickLine(
				curve.getPoints(24),
				mark ? mark.colour : RING_TOKENS.line,
				opacityOf(mark),
				isLit ? RING_LINE_WIDTH_PX.lit : RING_LINE_WIDTH_PX.unlit
			);
			world.add(line);
			const isHidden = isPrivate(link.childId) || link.parentIds.some(isPrivate);
			stage.trackLink(key, curve.getPoint(0.5), isHidden ? null : line);
		}

		// Frames every ring, not just the focus person's: the outline of the top and bottom rings
		// must fit, aimed at the middle of the stack.
		const ys = layout.rings.map((r) => ringHeight(r.generation));
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

	return { ...stage.handle, setLayout };
}
