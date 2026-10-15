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
import { linkKey, type Highlight, type Mark } from '#lib/tree-layout/highlight.js';
import { buildOrbitPlan, orbitPositions } from '#lib/tree-layout/orrery-orbit.js';
import { LinkPickProxy } from './orrery-link-pick.js';
import { createThreeStage } from './three-stage.js';
import { HIGHLIGHT_TOKENS, ORRERY_TOKENS as T } from './tree-tokens.js';
import { DEFAULT_PALETTE, type Palette } from './palette.js';
import type { WebGlTreeScene } from './webgl-tree.js';
import { ORRERY_CAMERAS } from './webgl-cameras.js';
import type { RelationshipGraphPerson } from '#lib/tree-layout/types.js';

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
	setLayout(layout: OrreryLayout, highlight: Highlight, shouldRefit: boolean): void;
	/** Stops the orbital drift and the tether pulse; the picture holds at its laid-out positions. */
	setReducedMotion(isReduced: boolean): void;
}

/** A star's colour by sex. The Orrery's stars are lighter than the card borders, so they take the palette's star shade. */
function starColour(person: RelationshipGraphPerson, palette: Palette): string {
	if (person.isPrivate === true) return T.private;
	return person.sex === 'M'
		? palette.sex.male.star
		: person.sex === 'F'
			? palette.sex.female.star
			: palette.sex.unknown.star;
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

/** Items drawn together as one batch, because they share a line width. */
interface Group<T> {
	batch: SegmentBatch;
	items: T[];
}

/** One batch per distinct width: a width is a material property, so it cannot vary in a batch. */
function groupByWidth<T extends { widthPx: number }>(
	items: T[],
	segmentsEach: number,
	size: { width: number; height: number }
): Array<Group<T>> {
	const byWidth = new Map<number, T[]>();
	for (const item of items) {
		const list = byWidth.get(item.widthPx);
		if (list) list.push(item);
		else byWidth.set(item.widthPx, [item]);
	}
	return [...byWidth].map(([widthPx, list]) => ({
		batch: segmentBatch(list.length * segmentsEach, widthPx, size),
		items: list
	}));
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

/** A tether between two partners; colours and width come from the partnership's mark. */
interface Tether {
	a: string;
	b: string;
	phase: number;
	colourA: Color;
	colourB: Color;
	brightness: number;
	widthPx: number;
}

/** A line from a partnership's barycentre (or a lone parent) to a child. */
interface Descent {
	from: string[];
	to: string;
	brightness: number;
	colour: Color;
	widthPx: number;
	/** Null when the child or a parent is private: such a line is never picked. */
	proxy: LinkPickProxy | null;
	/** The line's midpoint, kept by reference by the stage for names and tests. */
	anchor: Vector3;
}

interface StarParts {
	mesh: Mesh;
	sprite: Sprite | null;
	halos: Mesh[];
}

interface UnionParts {
	/** The barycentre, kept by reference by the stage. */
	at: Vector3;
	partnerIds: string[];
	/** Absent for a union with one drawn partner, which has no binary to ring. */
	ring: Mesh | null;
	knot: Mesh | null;
	hit: Mesh | null;
}

const WHITE = new Color('#ffffff');

/**
 * @throws when the browser cannot give a WebGL context; the shell shows a message instead.
 */
export function createOrreryScene(
	host: HTMLElement,
	palette: Palette = DEFAULT_PALETTE
): OrreryScene {
	const stage = createThreeStage(host, {
		background: T.stage,
		cameraDirections: {
			[ORRERY_CAMERAS.ANGLED]: new Vector3(0.62, 0.42, 0.62),
			[ORRERY_CAMERAS.SIDE]: new Vector3(0, 0.05, 1)
		}
	});
	const star = stage.share(new SphereGeometry(T.starRadiusUnits, 24, 16));
	const halo = stage.share(new TorusGeometry(T.starRadiusUnits * T.focusScale * 1.5, 0.05, 8, 40));
	// Unit-radius: scaled per star, so the halo's tube thickens with it (a focus star's is larger).
	const markHalo = stage.share(
		new TorusGeometry(T.starRadiusUnits * T.haloScale, T.haloTube, 8, 40)
	);
	const accretion = stage.share(new RingGeometry(0.97, 1, 96));
	const knotGeometry = stage.share(new SphereGeometry(T.knotRadiusUnits, 12, 8));
	const unionHit = stage.share(new SphereGeometry(T.starRadiusUnits * T.unionHitScale, 8, 6));
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
		stars: Map<string, StarParts>;
		unions: UnionParts[];
		tetherGroups: Array<Group<Tether>>;
		descentGroups: Array<Group<Descent>>;
	} | null = null;
	let elapsedSeconds = 0;
	let lastTimeMs: number | null = null;

	const scratchA = new Vector3();
	const scratchColour = new Color();
	const pulseColour = new Color(T.pulse);
	const litColours = new Map<string, Color>();

	/** A mark's colour as the dark stage draws it; see {@link T.markLighten}. */
	function litColour(colour: string): Color {
		let result = litColours.get(colour);
		if (!result) {
			result = new Color(colour).lerp(WHITE, T.markLighten);
			litColours.set(colour, result);
		}
		return result;
	}

	/** How strongly a mark draws: the upstream path is lighter, and a shared mark brighter. */
	function strengthOf(mark: Mark): number {
		return (
			(mark.strength === 'soft' ? HIGHLIGHT_TOKENS.softOpacity : 1) *
			(mark.isShared ? T.sharedBoost : 1)
		);
	}

	function barycentre(ids: string[], shown: Map<string, Vector3>, into: Vector3): Vector3 {
		into.set(0, 0, 0);
		for (const id of ids) into.add(shown.get(id)!);
		return into.divideScalar(ids.length);
	}

	function writeTethers() {
		if (!live) return;
		const { shown } = live;
		for (const { batch, items } of live.tetherGroups) {
			let at = 0;
			for (const t of items) {
				const a = shown.get(t.a)!;
				const b = shown.get(t.b)!;
				for (let i = 0; i < TETHER_SEGMENTS; i++) {
					const f0 = i / TETHER_SEGMENTS;
					const f1 = (i + 1) / TETHER_SEGMENTS;
					batch.positions[at] = a.x + (b.x - a.x) * f0;
					batch.positions[at + 1] = a.y + (b.y - a.y) * f0;
					batch.positions[at + 2] = a.z + (b.z - a.z) * f0;
					batch.positions[at + 3] = a.x + (b.x - a.x) * f1;
					batch.positions[at + 4] = a.y + (b.y - a.y) * f1;
					batch.positions[at + 5] = a.z + (b.z - a.z) * f1;
					at += 6;
				}
			}
			batch.flush({ isPositionChanged: true, isColourChanged: false });
		}
	}

	/** The gradient between the partners' colours, with a bright pulse unless motion is reduced. */
	function writeTetherColours() {
		if (!live) return;
		for (const { batch, items } of live.tetherGroups) {
			let at = 0;
			for (const t of items) {
				const centre = (elapsedSeconds / T.pulseSeconds + t.phase) % 1;
				for (let i = 0; i < TETHER_SEGMENTS; i++) {
					for (const edge of [i, i + 1]) {
						const f = edge / TETHER_SEGMENTS;
						scratchColour.copy(t.colourA).lerp(t.colourB, f).multiplyScalar(t.brightness);
						if (!isReduced) {
							const away = f - centre;
							scratchColour.lerp(pulseColour, Math.exp(-(away * away) / PULSE_WIDTH) * 0.85);
						}
						batch.colours[at++] = scratchColour.r;
						batch.colours[at++] = scratchColour.g;
						batch.colours[at++] = scratchColour.b;
					}
				}
			}
			batch.flush({ isPositionChanged: false, isColourChanged: true });
		}
	}

	function writeDescents() {
		if (!live) return;
		const { shown } = live;
		for (const { batch, items } of live.descentGroups) {
			let at = 0;
			for (const d of items) {
				const from = barycentre(d.from, shown, scratchA);
				const to = shown.get(d.to)!;
				for (let i = 0; i < DESCENT_SEGMENTS; i++) {
					const f0 = i / DESCENT_SEGMENTS;
					const f1 = (i + 1) / DESCENT_SEGMENTS;
					batch.positions[at] = from.x + (to.x - from.x) * f0;
					batch.positions[at + 1] = from.y + (to.y - from.y) * f0;
					batch.positions[at + 2] = from.z + (to.z - from.z) * f0;
					batch.positions[at + 3] = from.x + (to.x - from.x) * f1;
					batch.positions[at + 4] = from.y + (to.y - from.y) * f1;
					batch.positions[at + 5] = from.z + (to.z - from.z) * f1;
					at += 6;
				}
				// The pick band and the anchor follow the drift by sharing the drawn end points.
				d.proxy?.start.copy(from);
				d.proxy?.end.copy(to);
				d.anchor.lerpVectors(from, to, 0.5);
			}
			batch.flush({ isPositionChanged: true, isColourChanged: false });
		}
	}

	function writeDescentColours() {
		if (!live) return;
		for (const { batch, items } of live.descentGroups) {
			let at = 0;
			for (const d of items)
				for (let i = 0; i < DESCENT_SEGMENTS; i++)
					for (const edge of [i, i + 1]) {
						// Bright where the line leaves the barycentre, fading toward the child.
						const f = 1 - (edge / DESCENT_SEGMENTS) * 0.65;
						scratchColour.copy(d.colour).multiplyScalar(d.brightness * f);
						batch.colours[at++] = scratchColour.r;
						batch.colours[at++] = scratchColour.g;
						batch.colours[at++] = scratchColour.b;
					}
			batch.flush({ isPositionChanged: false, isColourChanged: true });
		}
	}

	/** Moves every mesh, marker and line to the positions in `live.shown`. */
	function placeEverything() {
		if (!live) return;
		for (const [id, parts] of live.stars) {
			const at = live.shown.get(id)!;
			parts.mesh.position.copy(at);
			parts.sprite?.position.copy(at);
			for (const h of parts.halos) h.position.copy(at);
		}
		for (const u of live.unions) {
			barycentre(u.partnerIds, live.shown, u.at);
			u.ring?.position.copy(u.at);
			u.knot?.position.copy(u.at);
			u.hit?.position.copy(u.at);
		}
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

	function setLayout(layout: OrreryLayout, highlight: Highlight, shouldRefit: boolean) {
		// No highlight (the viewer cleared it): everyone is drawn plainly, nobody faded.
		const isQuiet = highlight.isQuiet;
		const world = stage.resetWorld();
		for (const material of glowMaterials) material.dispose();
		glowMaterials = [];
		batches = [];
		const size = stage.size();

		const shown = new Map<string, Vector3>();
		for (const p of layout.people) shown.set(p.id, new Vector3(p.x, p.y, p.z));
		const plan = buildOrbitPlan(layout);
		// At the current time, so a rebuild under a running drift does not snap back to rest.
		if (!isReduced) orbitPositions(layout, plan, elapsedSeconds, shown);

		const personById = new Map(layout.people.map((p) => [p.id, p]));
		const isPrivate = (id: string) => personById.get(id)?.person.isPrivate === true;
		const unionById = new Map(layout.unions.map((u) => [u.id, u]));

		// Many stars share a look, and with a whole tree that is thousands of identical materials.
		const starMaterials = new Map<string, MeshStandardMaterial>();
		const haloMaterials = new Map<string, MeshBasicMaterial>();
		const glowBy = new Map<string, SpriteMaterial>();
		const starMaterial = (colour: string, emissiveIntensity: number) => {
			const key = `${colour}:${emissiveIntensity}`;
			let material = starMaterials.get(key);
			if (!material) {
				material = new MeshStandardMaterial({
					color: colour,
					emissive: colour,
					emissiveIntensity,
					roughness: 0.4,
					metalness: 0
				});
				starMaterials.set(key, material);
			}
			return material;
		};
		const haloMaterial = (colour: Color, opacity: number) => {
			const key = `${colour.getHexString()}:${opacity}`;
			let material = haloMaterials.get(key);
			if (!material) {
				material = new MeshBasicMaterial({
					color: colour,
					transparent: opacity < 1,
					opacity,
					depthWrite: false
				});
				haloMaterials.set(key, material);
			}
			return material;
		};

		const stars = new Map<string, StarParts>();
		for (const p of layout.people) {
			const mark = highlight.people.get(p.id);
			const isPrivatePerson = p.person.isPrivate === true;
			// The focus person (a focus source, not a partnership or trace item) keeps the larger
			// star and the white ring it has always had.
			const isFocus =
				mark?.kind === 'self' && highlight.sources[mark.sourceIndexes[0]]?.source.kind === 'focus';
			const isLit = isQuiet || mark !== undefined;
			const isSoft = mark?.strength === 'soft';
			const colour = starColour(p.person, palette);
			const at = shown.get(p.id)!;
			const mesh = new Mesh(
				star,
				starMaterial(
					colour,
					isPrivatePerson ? 0.25 : isSoft ? T.softStar : isLit ? 1.15 : T.dimStar
				)
			);
			if (isFocus) mesh.scale.setScalar(T.focusScale);
			world.add(mesh);

			let sprite: Sprite | null = null;
			if (!isPrivatePerson) {
				const opacity = isSoft ? T.softGlow : isLit ? 0.85 : T.dimGlow;
				const key = `${colour}:${opacity}`;
				let material = glowBy.get(key);
				if (!material) {
					material = new SpriteMaterial({
						map: glow,
						color: colour,
						blending: AdditiveBlending,
						transparent: true,
						depthWrite: false,
						opacity
					});
					glowBy.set(key, material);
					glowMaterials.push(material);
				}
				sprite = new Sprite(material);
				sprite.scale.setScalar(T.starRadiusUnits * T.glowScale * (isFocus ? T.focusScale : 1));
				world.add(sprite);
			}

			// Highlights show as halos in the mark's colour, never as a sex colour: the star keeps
			// its own. A star on two or more paths gets a second, larger halo.
			const halos: Mesh[] = [];
			if (mark && !isPrivatePerson) {
				const opacity = isSoft ? HIGHLIGHT_TOKENS.softOpacity : 1;
				const markColour = litColour(mark.colour);
				const ring = new Mesh(markHalo, haloMaterial(markColour, opacity));
				ring.rotation.x = Math.PI / 2;
				if (isFocus) ring.scale.setScalar(T.focusScale * 1.4);
				halos.push(ring);
				if (mark.isShared) {
					const outer = new Mesh(markHalo, haloMaterial(markColour, opacity));
					outer.rotation.x = Math.PI / 2;
					outer.scale.setScalar(
						(isFocus ? T.focusScale * 1.4 : 1) * (T.sharedHaloScale / T.haloScale)
					);
					halos.push(outer);
				}
			}
			if (isFocus) {
				const focusHalo = new Mesh(halo, new MeshBasicMaterial({ color: T.focusHalo }));
				focusHalo.rotation.x = Math.PI / 2;
				halos.push(focusHalo);
			}
			for (const h of halos) world.add(h);
			stars.set(p.id, { mesh, sprite, halos });
			stage.track(p.id, at, isPrivatePerson ? null : mesh);
		}

		const unionParts: UnionParts[] = [];
		const tethers: Tether[] = [];
		for (const u of layout.unions) {
			const mark = highlight.unions.get(u.id);
			const at = new Vector3();
			const parts: UnionParts = {
				at,
				partnerIds: u.partnerIds,
				ring: null,
				knot: null,
				hit: null
			};
			unionParts.push(parts);
			if (u.partnerIds.length < 2) {
				// One drawn partner: the children's lines leave that star, so there is no binary to
				// mark and nothing to hit that the star does not already answer for.
				stage.trackUnion(u.id, at, null);
				continue;
			}
			const opacityFactor = mark ? strengthOf(mark) : isQuiet ? 1 : T.dimTether;
			const ring = new Mesh(
				accretion,
				new MeshBasicMaterial({
					color: mark ? litColour(mark.colour) : T.accretion,
					transparent: true,
					opacity: T.accretionOpacity * (mark ? 2.4 * opacityFactor : isQuiet ? 1 : 0.6),
					blending: AdditiveBlending,
					side: DoubleSide,
					depthWrite: false
				})
			);
			// Lies in the plane of the generation, through both partners, as an orbit would.
			ring.rotation.x = -Math.PI / 2;
			ring.scale.setScalar(u.distance / 2);
			world.add(ring);
			// The partnership's visible marker: a small bright knot at the barycentre, with a hit
			// target as large as a star because the knot alone is too small to click.
			const knot = new Mesh(
				knotGeometry,
				new MeshBasicMaterial({
					color: mark ? litColour(mark.colour) : T.accretion,
					transparent: !mark,
					opacity: mark ? 1 : isQuiet ? 0.9 : 0.5
				})
			);
			if (mark) knot.scale.setScalar(mark.isShared ? 1.9 : 1.5);
			world.add(knot);
			const hit = new Mesh(unionHit, new MeshBasicMaterial({ visible: false }));
			world.add(hit);
			parts.ring = ring;
			parts.knot = knot;
			parts.hit = hit;
			stage.trackUnion(u.id, at, u.partnerIds.some(isPrivate) ? null : hit);

			for (let i = 0; i + 1 < u.partnerIds.length; i++) {
				const a = personById.get(u.partnerIds[i])!;
				const b = personById.get(u.partnerIds[i + 1])!;
				// A marked partnership's tether runs between its partners' own mark colours (their
				// ancestors' palette), else the union's; a shared one is the intersection colour.
				const markOf = (id: string) =>
					mark && !mark.isShared ? (highlight.people.get(id)?.colour ?? mark.colour) : mark?.colour;
				const colourOf = (person: typeof a) => {
					const colour = markOf(person.id);
					return colour ? litColour(colour).clone() : new Color(starColour(person.person, palette));
				};
				tethers.push({
					a: a.id,
					b: b.id,
					phase: unitFromId(`${u.id}:${i}`, 11),
					colourA: colourOf(a),
					colourB: colourOf(b),
					brightness: mark ? 0.7 * strengthOf(mark) : isQuiet ? 0.7 : 0.7 * T.dimTether,
					widthPx: mark ? (mark.isShared ? T.sharedTetherPx : T.markedTetherPx) : T.tetherPx
				});
			}
		}

		const descents: Descent[] = [];
		for (const link of layout.childLinks) {
			const from =
				link.fromUnionId !== null
					? unionById.get(link.fromUnionId)!.partnerIds
					: [link.fromPersonId!];
			const key = linkKey(link);
			const mark = highlight.links.get(key);
			const widthPx = mark ? (mark.isShared ? T.sharedLinePx : T.markedLinePx) : T.plainLinePx;
			const isHidden = isPrivate(link.childId) || link.parentIds.some(isPrivate);
			const proxy = isHidden ? null : new LinkPickProxy(widthPx, () => stage.size());
			const anchor = new Vector3();
			descents.push({
				from,
				to: link.childId,
				brightness: mark ? strengthOf(mark) : isQuiet ? 1 : T.dimLine,
				colour: mark ? litColour(mark.colour) : new Color(T.lineDim),
				widthPx,
				proxy,
				anchor
			});
			stage.trackLink(key, anchor, proxy);
		}

		const tetherGroups = groupByWidth(tethers, TETHER_SEGMENTS, size);
		const descentGroups = groupByWidth(descents, DESCENT_SEGMENTS, size);
		for (const { batch } of [...tetherGroups, ...descentGroups]) {
			world.add(batch.line);
			batches.push(batch);
		}

		live = { layout, plan, shown, stars, unions: unionParts, tetherGroups, descentGroups };
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
