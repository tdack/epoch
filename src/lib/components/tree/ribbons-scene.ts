/**
 * The WebGL side of the Ribbons view: a three.js scene drawn from a `RibbonsLayout`. Ribbons are
 * tapered tubes merged into two meshes (the focus line, and everyone else faded); knots are
 * emissive spheres with an additive glow. `RibbonsCanvas.svelte` imports this module dynamically,
 * so three.js is fetched only by someone who opens the view.
 *
 * Picking: the merged meshes are not pickable. Each person gets an invisible proxy sphere, which
 * costs no draw call, and `ThreeStage.track` maps it back to the person.
 */

import {
	AdditiveBlending,
	BufferGeometry,
	CanvasTexture,
	Color,
	Float32BufferAttribute,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	Points,
	PointsMaterial,
	SRGBColorSpace,
	SphereGeometry,
	TorusGeometry,
	Vector3
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
	RIBBON_STRAND_KINDS,
	type RibbonStrand,
	type RibbonsLayout
} from '#lib/tree-layout/ribbons.js';
import { nodeGeometry, strandGeometry } from './ribbons-tubes.js';
import { createThreeStage, sexColour } from './three-stage.js';
import { RIBBON_FADE, RIBBON_SIZES, RIBBON_TOKENS } from './tree-tokens.js';
import type { TreeRole, WebGlTreeScene } from './webgl-tree.js';

const FOCUS_SCALE = 1.45;
const PICK_RADIUS_UNITS = 0.95;
/** Extra lines for a person's further parent links are drawn at this fraction of the radius. */
const EXTRA_ENTRY_THINNING = 0.5;

export const RIBBONS_CAMERAS = { ANGLED: 'angled', SIDE: 'side', EDGE: 'edge' } as const;

export interface RibbonsScene extends WebGlTreeScene {
	/** Rebuild everything from a new layout. `shouldRefit` also resets the camera distance. */
	setLayout(layout: RibbonsLayout, roles: Map<string, TreeRole>, shouldRefit: boolean): void;
}

/** A soft round falloff for the knots' glow, drawn once on a canvas. */
function glowTexture(): CanvasTexture {
	const size = 64;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const context = canvas.getContext('2d')!;
	const gradient = context.createRadialGradient(
		size / 2,
		size / 2,
		0,
		size / 2,
		size / 2,
		size / 2
	);
	gradient.addColorStop(0, 'rgba(255,255,255,1)');
	gradient.addColorStop(0.25, 'rgba(255,255,255,0.45)');
	gradient.addColorStop(1, 'rgba(255,255,255,0)');
	context.fillStyle = gradient;
	context.fillRect(0, 0, size, size);
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	return texture;
}

/**
 * @throws when the browser cannot give a WebGL context; the shell shows a message instead.
 */
export function createRibbonsScene(host: HTMLElement): RibbonsScene {
	const stage = createThreeStage(host, {
		background: RIBBON_TOKENS.stage,
		cameraDirections: {
			[RIBBONS_CAMERAS.ANGLED]: new Vector3(0.7, 0.14, 0.7),
			[RIBBONS_CAMERAS.SIDE]: new Vector3(0, 0.03, 1),
			[RIBBONS_CAMERAS.EDGE]: new Vector3(1, 0.03, 0)
		}
	});
	const halo = stage.share(new TorusGeometry(RIBBON_SIZES.node * FOCUS_SCALE * 1.5, 0.05, 8, 40));
	const pickProxy = stage.share(new SphereGeometry(PICK_RADIUS_UNITS, 8, 6));
	const glow = glowTexture();
	// Points and the glow texture are not freed by `resetWorld`, so they are tracked here.
	let disposables: Array<{ dispose(): void }> = [];

	function freeExtras() {
		for (const d of disposables) d.dispose();
		disposables = [];
	}

	function setLayout(layout: RibbonsLayout, roles: Map<string, TreeRole>, shouldRefit: boolean) {
		freeExtras();
		const world = stage.resetWorld();

		const personById = new Map(layout.people.map((p) => [p.id, p]));
		const isLitPerson = (id: string) => roles.has(id);
		const ys = layout.people.map((p) => p.y);
		const top = ys.length > 0 ? Math.max(...ys) : 0;
		const bottom = ys.length > 0 ? Math.min(...ys) : 0;
		const radiusAt = (y: number) => {
			const t = top === bottom ? 0 : Math.min(1, Math.max(0, (top - y) / (top - bottom)));
			return RIBBON_SIZES.tubeOldest + (RIBBON_SIZES.tubeYoungest - RIBBON_SIZES.tubeOldest) * t;
		};
		const knotColour = new Color(RIBBON_TOKENS.knot);
		const colourOf = (id: string) => new Color(sexColour(personById.get(id)!.person));

		const lit: BufferGeometry[] = [];
		const faded: BufferGeometry[] = [];
		const add = (isLit: boolean, geometry: BufferGeometry) => (isLit ? lit : faded).push(geometry);

		const mid = new Color();
		for (const s of layout.strands as RibbonStrand[]) {
			const isLit = isLitPerson(s.personId);
			const own = colourOf(s.personId);
			const from = new Vector3(s.from.x, s.from.y, s.from.z);
			const to = new Vector3(s.to.x, s.to.y, s.to.z);
			const thin = s.kind === RIBBON_STRAND_KINDS.EXTRA_ENTRY ? EXTRA_ENTRY_THINNING : 1;
			const isJoin = s.kind === RIBBON_STRAND_KINDS.JOIN;
			// An entry starts at the knot's warm light and settles into the person's own colour; a
			// join does the reverse. The knot colour never depends on a partner's sex.
			mid.copy(own).lerp(knotColour, 0.55);
			add(
				isLit,
				strandGeometry({
					from,
					to,
					radiusFrom: radiusAt(from.y) * thin,
					radiusTo: radiusAt(to.y) * thin,
					colourFrom: isJoin ? own : s.isStub ? own : mid.clone(),
					colourTo: isJoin ? mid.clone() : own,
					alpha: isLit ? 1 : RIBBON_FADE.person,
					braid: isJoin
						? { index: s.braidIndex, count: s.braidCount, radius: RIBBON_SIZES.braid }
						: null
				})
			);
		}

		const proxyMaterial = new MeshBasicMaterial({ visible: false });
		for (const p of layout.people) {
			const position = new Vector3(p.x, p.y, p.z);
			const isLit = isLitPerson(p.id);
			const isFocus = roles.get(p.id) === 'focus';
			add(
				isLit,
				nodeGeometry(
					position,
					RIBBON_SIZES.node * (isFocus ? FOCUS_SCALE : 1),
					colourOf(p.id),
					isLit ? 1 : RIBBON_FADE.person
				)
			);
			if (isFocus) {
				const ring = new Mesh(halo, new MeshBasicMaterial({ color: RIBBON_TOKENS.focus }));
				ring.position.copy(position);
				ring.rotation.x = Math.PI / 2;
				world.add(ring);
			}
			const isPrivate = p.person.isPrivate === true;
			const proxy = new Mesh(pickProxy, proxyMaterial);
			proxy.position.copy(position);
			world.add(proxy);
			stage.track(p.id, position, isPrivate ? null : proxy);
		}

		const addMerged = (parts: BufferGeometry[], isLit: boolean) => {
			if (parts.length === 0) return;
			const merged = mergeGeometries(parts, false);
			for (const part of parts) part.dispose();
			world.add(
				new Mesh(
					merged,
					new MeshStandardMaterial({
						vertexColors: true,
						roughness: 0.5,
						metalness: 0.08,
						transparent: !isLit,
						depthWrite: isLit
					})
				)
			);
		};
		addMerged(lit, true);
		addMerged(faded, false);

		// Knots: emissive spheres (merged) and an additive glow (one Points draw).
		const knotLit: BufferGeometry[] = [];
		const knotFaded: BufferGeometry[] = [];
		const glowPositions: number[] = [];
		const glowColours: number[] = [];
		const glowColour = new Color(RIBBON_TOKENS.glow);
		for (const u of layout.unions) {
			const isLit = u.partnerIds.some(isLitPerson);
			const at = new Vector3(u.x, u.y, u.z);
			(isLit ? knotLit : knotFaded).push(
				nodeGeometry(at, RIBBON_SIZES.knot, knotColour, isLit ? 1 : RIBBON_FADE.knot)
			);
			glowPositions.push(u.x, u.y, u.z);
			const strength = isLit ? 1 : RIBBON_FADE.glow;
			glowColours.push(glowColour.r * strength, glowColour.g * strength, glowColour.b * strength);
		}
		for (const [parts, isLit] of [
			[knotLit, true],
			[knotFaded, false]
		] as const) {
			if (parts.length === 0) continue;
			const merged = mergeGeometries(parts, false);
			for (const part of parts) part.dispose();
			world.add(
				new Mesh(
					merged,
					new MeshBasicMaterial({ vertexColors: true, transparent: !isLit, depthWrite: isLit })
				)
			);
		}
		if (glowPositions.length > 0) {
			const geometry = new BufferGeometry();
			geometry.setAttribute('position', new Float32BufferAttribute(glowPositions, 3));
			geometry.setAttribute('color', new Float32BufferAttribute(glowColours, 3));
			const material = new PointsMaterial({
				size: RIBBON_SIZES.glow,
				map: glow,
				vertexColors: true,
				blending: AdditiveBlending,
				transparent: true,
				depthWrite: false,
				sizeAttenuation: true
			});
			disposables.push(geometry, material);
			world.add(new Points(geometry, material));
		}

		const points = [
			...layout.people.map((p) => new Vector3(p.x, p.y, p.z)),
			...layout.unions.map((u) => new Vector3(u.x, u.y, u.z)),
			...layout.strands
				.filter((s) => s.isStub)
				.map((s) => new Vector3(s.from.x, s.from.y, s.from.z))
		];
		const centre = new Vector3();
		for (const point of points) centre.add(point);
		if (points.length > 0) centre.divideScalar(points.length);
		stage.frame(points, centre, shouldRefit);
	}

	return {
		...stage.handle,
		setLayout,
		dispose() {
			freeExtras();
			glow.dispose();
			stage.handle.dispose();
		}
	};
}
