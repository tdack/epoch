/**
 * The WebGL side of the Orrery view: a three.js scene drawn from an `OrreryLayout`. Stars are
 * emissive spheres with a glow sprite, a union's partners are joined by a luminous tether with a
 * pulse running along it, and a faint accretion ring marks the barycentre the children descend
 * from. `OrreryCanvas.svelte` imports this module dynamically, so three.js is fetched only by
 * someone who opens the view.
 *
 * The lines are two merged `LineSegments2` (tethers and descents) rather than one object each, and
 * their buffers are rewritten in place while the orbital drift runs. The scene draws on demand
 * except while that drift or a tether pulse is animating.
 */

import {
	AdditiveBlending,
	CanvasTexture,
	Color,
	DoubleSide,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	RingGeometry,
	SphereGeometry,
	Sprite,
	SpriteMaterial,
	TorusGeometry,
	Vector3
} from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { unitFromId, type OrreryLayout } from '#lib/tree-layout/orrery.js';
import { buildOrbitPlan, orbitPositions } from '#lib/tree-layout/orrery-orbit.js';
import { createThreeStage } from './three-stage.js';
import { ORRERY_TOKENS as T } from './tree-tokens.js';
import type { TreeRole, WebGlTreeScene } from './webgl-tree.js';
import type { RelationshipGraphPerson } from '#lib/tree-layout/types.js';

export const ORRERY_CAMERAS = { ANGLED: 'angled', SIDE: 'side' } as const;

/** Segments along a tether, so its gradient and pulse have something to colour. */
const TETHER_SEGMENTS = 14;
/** Segments along a descent line: it fades from bright at the barycentre to dim at the child. */
const DESCENT_SEGMENTS = 6;
/** Longest frame the drift will advance by, so a backgrounded tab does not leap on return. */
const MAX_FRAME_SECONDS = 0.1;
const PULSE_WIDTH = 0.012;
const SOFT_EDGE_PIXELS = 64;

export interface OrreryScene extends WebGlTreeScene {
	/** Rebuild everything from a new layout. `shouldRefit` also resets the camera distance. */
	setLayout(layout: OrreryLayout, roles: Map<string, TreeRole>, shouldRefit: boolean): void;
	/** Stops the orbital drift and the tether pulse; the picture holds at its laid-out positions. */
	setReducedMotion(isReduced: boolean): void;
}

function starColour(person: RelationshipGraphPerson): string {
	if (person.isPrivate === true) return T.private;
	return person.sex === 'M' ? T.male : person.sex === 'F' ? T.female : T.unknownSex;
}

/** A soft round falloff, white so a sprite's material colour tints it. */
function glowTexture(): CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = SOFT_EDGE_PIXELS;
	const context = canvas.getContext('2d')!;
	const half = SOFT_EDGE_PIXELS / 2;
	const gradient = context.createRadialGradient(half, half, 0, half, half, half);
	gradient.addColorStop(0, 'rgba(255,255,255,1)');
	gradient.addColorStop(0.25, 'rgba(255,255,255,0.45)');
	gradient.addColorStop(1, 'rgba(255,255,255,0)');
	context.fillStyle = gradient;
	context.fillRect(0, 0, SOFT_EDGE_PIXELS, SOFT_EDGE_PIXELS);
	return new CanvasTexture(canvas);
}

/**
 * A batch of line segments drawn as one object. The arrays are the ones the geometry reads from,
 * so writing into them and calling `flush` moves the lines without allocating.
 */
interface SegmentBatch {
	line: LineSegments2;
	material: LineMaterial;
	positions: Float32Array;
	colours: Float32Array;
	flush(options: { isPositionChanged: boolean; isColourChanged: boolean }): void;
}

function segmentBatch(
	segmentCount: number,
	widthPx: number,
	size: { width: number; height: number }
): SegmentBatch {
	const positions = new Float32Array(segmentCount * 6);
	const colours = new Float32Array(segmentCount * 6);
	const geometry = new LineSegmentsGeometry();
	geometry.setPositions(positions);
	geometry.setColors(colours);
	const material = new LineMaterial({
		linewidth: widthPx,
		vertexColors: true,
		transparent: true,
		depthWrite: false,
		blending: AdditiveBlending
	});
	material.resolution.set(size.width, size.height);
	const line = new LineSegments2(geometry, material);
	// The buffers are rewritten in place while drifting; a bounding sphere from the first fill
	// would cull lines that have moved out of it.
	line.frustumCulled = false;
	return {
		line,
		material,
		positions,
		colours,
		flush({ isPositionChanged, isColourChanged }) {
			if (isPositionChanged)
				(
					geometry.getAttribute('instanceStart') as unknown as { data: { needsUpdate: boolean } }
				).data.needsUpdate = true;
			if (isColourChanged)
				(
					geometry.getAttribute('instanceColorStart') as unknown as {
						data: { needsUpdate: boolean };
					}
				).data.needsUpdate = true;
		}
	};
}

/**
 * @throws when the browser cannot give a WebGL context; the shell shows a message instead.
 */
export function createOrreryScene(host: HTMLElement): OrreryScene {
	const stage = createThreeStage(host, {
		background: T.stage,
		cameraDirections: {
			[ORRERY_CAMERAS.ANGLED]: new Vector3(0.62, 0.42, 0.62),
			[ORRERY_CAMERAS.SIDE]: new Vector3(0, 0.05, 1)
		}
	});
	const star = stage.share(new SphereGeometry(T.starRadiusUnits, 24, 16));
	const halo = stage.share(new TorusGeometry(T.starRadiusUnits * T.focusScale * 1.5, 0.05, 8, 40));
	const accretion = stage.share(new RingGeometry(0.97, 1, 96));
	const glow = glowTexture();

	// The plain (non-fat) lines of the stage re-read the canvas size on resize; these do it here.
	let batches: SegmentBatch[] = [];
	const onResize = new ResizeObserver(() => {
		const { width, height } = stage.size();
		for (const batch of batches) batch.material.resolution.set(width, height);
		stage.handle.requestFrame();
	});
	onResize.observe(host);

	let isReduced = false;
	let glowMaterials: SpriteMaterial[] = [];
	/** What the animator drives; replaced by every `setLayout`. */
	let live: {
		layout: OrreryLayout;
		plan: ReturnType<typeof buildOrbitPlan>;
		shown: Map<string, Vector3>;
		stars: Map<string, { mesh: Mesh; sprite: Sprite | null; halo: Mesh | null }>;
		rings: Array<{ mesh: Mesh; partnerIds: string[] }>;
		tethers: Array<{ a: string; b: string; phase: number; colourA: Color; colourB: Color }>;
		descents: Array<{ from: string[]; to: string; brightness: number; colour: Color }>;
		tetherBatch: SegmentBatch | null;
		descentBatch: SegmentBatch | null;
	} | null = null;
	let elapsedSeconds = 0;
	let lastTimeMs: number | null = null;

	const scratchA = new Vector3();
	const scratchB = new Vector3();
	const scratchColour = new Color();
	const pulseColour = new Color(T.pulse);

	function barycentre(ids: string[], shown: Map<string, Vector3>, into: Vector3): Vector3 {
		into.set(0, 0, 0);
		for (const id of ids) into.add(shown.get(id)!);
		return into.divideScalar(ids.length);
	}

	function writeTethers() {
		if (!live?.tetherBatch) return;
		const { tethers, shown, tetherBatch } = live;
		let at = 0;
		for (const t of tethers) {
			const a = shown.get(t.a)!;
			const b = shown.get(t.b)!;
			for (let i = 0; i < TETHER_SEGMENTS; i++) {
				const f0 = i / TETHER_SEGMENTS;
				const f1 = (i + 1) / TETHER_SEGMENTS;
				tetherBatch.positions[at] = a.x + (b.x - a.x) * f0;
				tetherBatch.positions[at + 1] = a.y + (b.y - a.y) * f0;
				tetherBatch.positions[at + 2] = a.z + (b.z - a.z) * f0;
				tetherBatch.positions[at + 3] = a.x + (b.x - a.x) * f1;
				tetherBatch.positions[at + 4] = a.y + (b.y - a.y) * f1;
				tetherBatch.positions[at + 5] = a.z + (b.z - a.z) * f1;
				at += 6;
			}
		}
		tetherBatch.flush({ isPositionChanged: true, isColourChanged: false });
	}

	/** The gradient between the partners' colours, with a bright pulse unless motion is reduced. */
	function writeTetherColours() {
		if (!live?.tetherBatch) return;
		const { tethers, tetherBatch } = live;
		let at = 0;
		for (const t of tethers) {
			const centre = (elapsedSeconds / T.pulseSeconds + t.phase) % 1;
			for (let i = 0; i < TETHER_SEGMENTS; i++) {
				for (const edge of [i, i + 1]) {
					const f = edge / TETHER_SEGMENTS;
					scratchColour.copy(t.colourA).lerp(t.colourB, f).multiplyScalar(0.7);
					if (!isReduced) {
						const away = f - centre;
						scratchColour.lerp(pulseColour, Math.exp(-(away * away) / PULSE_WIDTH) * 0.85);
					}
					tetherBatch.colours[at++] = scratchColour.r;
					tetherBatch.colours[at++] = scratchColour.g;
					tetherBatch.colours[at++] = scratchColour.b;
				}
			}
		}
		tetherBatch.flush({ isPositionChanged: false, isColourChanged: true });
	}

	function writeDescents() {
		if (!live?.descentBatch) return;
		const { descents, shown, descentBatch } = live;
		let at = 0;
		for (const d of descents) {
			const from = barycentre(d.from, shown, scratchA);
			const to = shown.get(d.to)!;
			for (let i = 0; i < DESCENT_SEGMENTS; i++) {
				const f0 = i / DESCENT_SEGMENTS;
				const f1 = (i + 1) / DESCENT_SEGMENTS;
				descentBatch.positions[at] = from.x + (to.x - from.x) * f0;
				descentBatch.positions[at + 1] = from.y + (to.y - from.y) * f0;
				descentBatch.positions[at + 2] = from.z + (to.z - from.z) * f0;
				descentBatch.positions[at + 3] = from.x + (to.x - from.x) * f1;
				descentBatch.positions[at + 4] = from.y + (to.y - from.y) * f1;
				descentBatch.positions[at + 5] = from.z + (to.z - from.z) * f1;
				at += 6;
			}
		}
		descentBatch.flush({ isPositionChanged: true, isColourChanged: false });
	}

	function writeDescentColours() {
		if (!live?.descentBatch) return;
		const { descents, descentBatch } = live;
		let at = 0;
		for (const d of descents)
			for (let i = 0; i < DESCENT_SEGMENTS; i++)
				for (const edge of [i, i + 1]) {
					// Bright where the line leaves the barycentre, fading toward the child.
					const f = 1 - (edge / DESCENT_SEGMENTS) * 0.65;
					scratchColour.copy(d.colour).multiplyScalar(d.brightness * f);
					descentBatch.colours[at++] = scratchColour.r;
					descentBatch.colours[at++] = scratchColour.g;
					descentBatch.colours[at++] = scratchColour.b;
				}
		descentBatch.flush({ isPositionChanged: false, isColourChanged: true });
	}

	/** Moves every mesh, ring and line to the positions in `live.shown`. */
	function placeEverything() {
		if (!live) return;
		for (const [id, parts] of live.stars) {
			const at = live.shown.get(id)!;
			parts.mesh.position.copy(at);
			parts.sprite?.position.copy(at);
			parts.halo?.position.copy(at);
		}
		for (const ring of live.rings)
			ring.mesh.position.copy(barycentre(ring.partnerIds, live.shown, scratchB));
		writeTethers();
		writeDescents();
	}

	stage.addAnimator((timeMs) => {
		if (!live || isReduced) {
			lastTimeMs = null;
			return false;
		}
		const dt = lastTimeMs === null ? 0 : Math.min((timeMs - lastTimeMs) / 1000, MAX_FRAME_SECONDS);
		lastTimeMs = timeMs;
		elapsedSeconds += dt;
		orbitPositions(live.layout, live.plan, elapsedSeconds, live.shown);
		placeEverything();
		writeTetherColours();
		return true;
	});

	function setLayout(layout: OrreryLayout, roles: Map<string, TreeRole>, shouldRefit: boolean) {
		// No highlight (the viewer cleared it): everyone is drawn plainly, nobody faded.
		const isQuiet = roles.size === 0;
		const world = stage.resetWorld();
		for (const material of glowMaterials) material.dispose();
		glowMaterials = [];
		batches = [];
		const size = stage.size();
		const isOnLine = (id: string) => {
			const role = roles.get(id);
			return role === 'focus' || role === 'ancestor' || role === 'descendant';
		};

		const shown = new Map<string, Vector3>();
		for (const p of layout.people) shown.set(p.id, new Vector3(p.x, p.y, p.z));
		const plan = buildOrbitPlan(layout);
		// At the current time, so a rebuild under a running drift does not snap back to rest.
		if (!isReduced) orbitPositions(layout, plan, elapsedSeconds, shown);

		const glowBy = new Map<string, SpriteMaterial>();
		const stars = new Map<string, { mesh: Mesh; sprite: Sprite | null; halo: Mesh | null }>();
		for (const p of layout.people) {
			const role = roles.get(p.id) ?? null;
			const isPrivate = p.person.isPrivate === true;
			const isLit = isQuiet || role !== null;
			const colour = starColour(p.person);
			const at = shown.get(p.id)!;
			const mesh = new Mesh(
				star,
				new MeshStandardMaterial({
					color: colour,
					emissive: colour,
					emissiveIntensity: isPrivate ? 0.25 : isLit ? 1.15 : T.dimStar,
					roughness: 0.4,
					metalness: 0
				})
			);
			if (role === 'focus') mesh.scale.setScalar(T.focusScale);
			world.add(mesh);

			let sprite: Sprite | null = null;
			if (!isPrivate) {
				const key = `${colour}:${isLit}`;
				let material = glowBy.get(key);
				if (!material) {
					material = new SpriteMaterial({
						map: glow,
						color: colour,
						blending: AdditiveBlending,
						transparent: true,
						depthWrite: false,
						opacity: isLit ? 0.85 : T.dimGlow
					});
					glowBy.set(key, material);
					glowMaterials.push(material);
				}
				sprite = new Sprite(material);
				sprite.scale.setScalar(
					T.starRadiusUnits * T.glowScale * (role === 'focus' ? T.focusScale : 1)
				);
				world.add(sprite);
			}
			let focusHalo: Mesh | null = null;
			if (role === 'focus') {
				focusHalo = new Mesh(halo, new MeshBasicMaterial({ color: T.focusHalo }));
				focusHalo.rotation.x = Math.PI / 2;
				world.add(focusHalo);
			}
			stars.set(p.id, { mesh, sprite, halo: focusHalo });
			stage.track(p.id, at, isPrivate ? null : mesh);
		}

		const personById = new Map(layout.people.map((p) => [p.id, p]));
		const rings: NonNullable<typeof live>['rings'] = [];
		const tethers: NonNullable<typeof live>['tethers'] = [];
		for (const u of layout.unions) {
			if (u.partnerIds.length < 2) continue;
			const isLit = u.partnerIds.some(isOnLine);
			const ring = new Mesh(
				accretion,
				new MeshBasicMaterial({
					color: T.accretion,
					transparent: true,
					opacity: T.accretionOpacity * (isLit ? 1.6 : 1),
					blending: AdditiveBlending,
					side: DoubleSide,
					depthWrite: false
				})
			);
			// Lies in the plane of the generation, through both partners, as an orbit would.
			ring.rotation.x = -Math.PI / 2;
			ring.scale.setScalar(u.distance / 2);
			world.add(ring);
			rings.push({ mesh: ring, partnerIds: u.partnerIds });
			for (let i = 0; i + 1 < u.partnerIds.length; i++) {
				const a = personById.get(u.partnerIds[i])!;
				const b = personById.get(u.partnerIds[i + 1])!;
				tethers.push({
					a: a.id,
					b: b.id,
					phase: unitFromId(`${u.id}:${i}`, 11),
					colourA: new Color(starColour(a.person)),
					colourB: new Color(starColour(b.person))
				});
			}
		}

		const descents: NonNullable<typeof live>['descents'] = [];
		for (const link of layout.childLinks) {
			const from =
				link.fromUnionId !== null
					? layout.unions.find((u) => u.id === link.fromUnionId)!.partnerIds
					: [link.fromPersonId!];
			const childRole = roles.get(link.childId) ?? null;
			const isLit =
				(childRole === 'descendant' && link.parentIds.some(isOnLine)) ||
				((childRole === 'focus' || childRole === 'ancestor') &&
					link.parentIds.some((id) => roles.get(id) === 'ancestor'));
			descents.push({
				from,
				to: link.childId,
				brightness: isLit || isQuiet ? 1 : T.dimLine,
				colour: new Color(isLit ? T.lineLit : T.lineDim)
			});
		}

		let tetherBatch: SegmentBatch | null = null;
		if (tethers.length > 0) {
			tetherBatch = segmentBatch(tethers.length * TETHER_SEGMENTS, T.tetherPx, size);
			world.add(tetherBatch.line);
			batches.push(tetherBatch);
		}
		let descentBatch: SegmentBatch | null = null;
		if (descents.length > 0) {
			// One width for the batch: the focus line is told apart by brightness, not thickness.
			descentBatch = segmentBatch(descents.length * DESCENT_SEGMENTS, T.litLinePx - 1, size);
			world.add(descentBatch.line);
			batches.push(descentBatch);
		}

		live = { layout, plan, shown, stars, rings, tethers, descents, tetherBatch, descentBatch };
		placeEverything();
		writeTetherColours();
		writeDescentColours();

		// Framed on the laid-out positions, padded by the widest orbit so the drift stays on screen.
		const rest = layout.people.map((p) => new Vector3(p.x, p.y, p.z));
		const centre = new Vector3();
		for (const point of rest) centre.add(point);
		if (rest.length > 0) centre.divideScalar(rest.length);
		stage.frame(rest, centre, shouldRefit);
	}

	function setReducedMotion(isNowReduced: boolean) {
		if (isNowReduced === isReduced) return;
		isReduced = isNowReduced;
		if (live) {
			if (isNowReduced) {
				// Hold at the laid-out picture rather than wherever the drift had reached.
				for (const p of live.layout.people) live.shown.get(p.id)!.set(p.x, p.y, p.z);
				placeEverything();
			}
			writeTetherColours();
		}
		stage.handle.requestFrame();
	}

	return {
		...stage.handle,
		dispose() {
			onResize.disconnect();
			for (const material of glowMaterials) material.dispose();
			glow.dispose();
			stage.dispose();
		},
		setLayout,
		setReducedMotion
	};
}
