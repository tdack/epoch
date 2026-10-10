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
	Vector3
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
	RIBBON_STRAND_KINDS,
	type RibbonStrand,
	type RibbonsLayout
} from '#lib/tree-layout/ribbons.js';
import { linkKey, type Highlight, type Mark } from '#lib/tree-layout/highlight.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { haloGeometry, nodeGeometry, strandCentreline, strandGeometry } from './ribbons-tubes.js';
import { createThreeStage, sexColour } from './three-stage.js';
import { HIGHLIGHT_TOKENS, RIBBON_FADE, RIBBON_SIZES, RIBBON_TOKENS } from './tree-tokens.js';
import type { WebGlTreeScene } from './webgl-tree.js';
import { RIBBONS_CAMERAS } from './webgl-cameras.js';

const FOCUS_SCALE = 1.45;
const PICK_RADIUS_UNITS = 0.95;
/** Extra lines for a person's further parent links are drawn at this fraction of the radius. */
const EXTRA_ENTRY_THINNING = 0.5;
/** The sample of a strand's centreline where its link is anchored: the middle, exactly on the polyline. */
const LINK_ANCHOR_SAMPLE = 8;

export interface RibbonsScene extends WebGlTreeScene {
	/** Rebuild everything from a new layout. `shouldRefit` also resets the camera distance. */
	setLayout(layout: RibbonsLayout, highlight: Highlight, shouldRefit: boolean): void;
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
	const pickProxy = stage.share(new SphereGeometry(PICK_RADIUS_UNITS, 8, 6));
	const glow = glowTexture();
	// Points and the glow texture are not freed by `resetWorld`, so they are tracked here.
	let disposables: Array<{ dispose(): void }> = [];

	function freeExtras() {
		for (const d of disposables) d.dispose();
		disposables = [];
	}

	function setLayout(layout: RibbonsLayout, highlight: Highlight, shouldRefit: boolean) {
		// No highlight (the viewer cleared it): everyone is drawn plainly, nobody faded.
		const isQuiet = highlight.isQuiet;
		freeExtras();
		const world = stage.resetWorld();

		const personById = new Map(layout.people.map((p) => [p.id, p]));
		const isPrivate = (id: string) => personById.get(id)?.person.isPrivate === true;
		const ys = layout.people.map((p) => p.y);
		const top = ys.length > 0 ? Math.max(...ys) : 0;
		const bottom = ys.length > 0 ? Math.min(...ys) : 0;
		const radiusAt = (y: number) => {
			const t = top === bottom ? 0 : Math.min(1, Math.max(0, (top - y) / (top - bottom)));
			return RIBBON_SIZES.tubeOldest + (RIBBON_SIZES.tubeYoungest - RIBBON_SIZES.tubeOldest) * t;
		};
		const knotColour = new Color(RIBBON_TOKENS.knot);
		const colourOf = (id: string) => new Color(sexColour(personById.get(id)!.person));

		/** A mark's opacity: the upstream half is lighter, and what is off every path fades. */
		const opacityOf = (mark: Mark | undefined, fade: number) =>
			mark ? (mark.strength === 'soft' ? HIGHLIGHT_TOKENS.softOpacity : 1) : isQuiet ? 1 : fade;

		// Unions whose parent-child lines are marked: an ancestor's join into one is on the path.
		const unionsWithMarkedLine = new Set<string>();
		for (const link of layout.childLinks)
			if (link.fromUnionId !== null && highlight.links.has(linkKey(link)))
				unionsWithMarkedLine.add(link.fromUnionId);

		/** What lights a strand: a line's mark for an entry, and for a join the person's or knot's. */
		function markOfStrand(s: RibbonStrand): Mark | undefined {
			if (s.linkKey !== null) return highlight.links.get(s.linkKey);
			if (s.kind !== RIBBON_STRAND_KINDS.JOIN) return highlight.people.get(s.personId);
			const own = highlight.people.get(s.personId);
			const union = highlight.unions.get(s.unionId!);
			if (own && union) return own.isShared || !union.isShared ? own : union;
			// A focus walk marks no unions, so an ancestor's join counts only into a union on the path.
			if (own)
				return own.kind !== 'ancestor' || unionsWithMarkedLine.has(s.unionId!) ? own : undefined;
			return union;
		}

		// Tubes, spheres and knots are merged by opacity, not by person: opaque, and everything else
		// with alpha in the vertex colour. The draw-call count does not grow with the selection.
		const solid: BufferGeometry[] = [];
		const fading: BufferGeometry[] = [];
		const add = (alpha: number, geometry: BufferGeometry) =>
			(alpha >= 1 ? solid : fading).push(geometry);
		const halos: BufferGeometry[] = [];

		const mid = new Color();
		const markColour = new Color();
		for (const s of layout.strands) {
			const mark = markOfStrand(s);
			const alpha = opacityOf(mark, RIBBON_FADE.person);
			const own = colourOf(s.personId);
			const from = new Vector3(s.from.x, s.from.y, s.from.z);
			const to = new Vector3(s.to.x, s.to.y, s.to.z);
			const thin = s.kind === RIBBON_STRAND_KINDS.EXTRA_ENTRY ? EXTRA_ENTRY_THINNING : 1;
			const scale = thin * (mark?.isShared ? RIBBON_SIZES.sharedScale : 1);
			const isJoin = s.kind === RIBBON_STRAND_KINDS.JOIN;
			let colourFrom: Color;
			let colourTo: Color;
			if (mark) {
				// A highlight paints the whole tube its mark's colour; sex shows on the node.
				colourFrom = colourTo = markColour.set(mark.colour).clone();
			} else {
				// An entry starts at the knot's warm light and settles into the person's own colour; a
				// join does the reverse. The knot colour never depends on a partner's sex.
				mid.copy(own).lerp(knotColour, 0.55);
				colourFrom = isJoin ? own : s.isStub ? own : mid.clone();
				colourTo = isJoin ? mid.clone() : own;
			}
			add(
				alpha,
				strandGeometry({
					from,
					to,
					radiusFrom: radiusAt(from.y) * scale,
					radiusTo: radiusAt(to.y) * scale,
					colourFrom,
					colourTo,
					alpha,
					braid: isJoin
						? { index: s.braidIndex, count: s.braidCount, radius: RIBBON_SIZES.braid }
						: null
				})
			);
		}

		const proxyMaterial = new MeshBasicMaterial({ visible: false });
		for (const p of layout.people) {
			const position = new Vector3(p.x, p.y, p.z);
			const mark = highlight.people.get(p.id);
			const isFocus = p.id === layout.focusPersonId;
			const alpha = mark ? 1 : opacityOf(undefined, RIBBON_FADE.person);
			const radius = RIBBON_SIZES.node * (isFocus ? FOCUS_SCALE : 1);
			add(alpha, nodeGeometry(position, radius, colourOf(p.id), alpha));
			if (mark && !isQuiet) {
				// The focus keeps its light ring; every other lit person is ringed in their mark's colour,
				// twice when on several paths. Merged into one mesh below.
				const ringColour = new Color(isFocus ? RIBBON_TOKENS.focus : mark.colour);
				const ringAlpha = mark.strength === 'soft' ? HIGHLIGHT_TOKENS.softOpacity : 1;
				halos.push(
					haloGeometry(
						position,
						RIBBON_SIZES.node * RIBBON_SIZES.haloRadius * (isFocus ? FOCUS_SCALE : 1),
						RIBBON_SIZES.haloTube,
						ringColour,
						ringAlpha
					)
				);
				if (mark.isShared)
					halos.push(
						haloGeometry(
							position,
							RIBBON_SIZES.node * RIBBON_SIZES.haloSecondRadius,
							RIBBON_SIZES.haloTube,
							ringColour,
							ringAlpha
						)
					);
			}
			const proxy = new Mesh(pickProxy, proxyMaterial);
			proxy.position.copy(position);
			world.add(proxy);
			stage.track(p.id, position, isPrivate(p.id) ? null : proxy);
		}

		const addMerged = (parts: BufferGeometry[], isOpaque: boolean, isStandard: boolean) => {
			if (parts.length === 0) return;
			const merged = mergeGeometries(parts, false);
			for (const part of parts) part.dispose();
			const parameters = {
				vertexColors: true,
				transparent: !isOpaque,
				depthWrite: isOpaque
			};
			world.add(
				new Mesh(
					merged,
					isStandard
						? new MeshStandardMaterial({ ...parameters, roughness: 0.5, metalness: 0.08 })
						: new MeshBasicMaterial(parameters)
				)
			);
		};
		addMerged(solid, true, true);
		addMerged(fading, false, true);
		addMerged(halos, false, false);

		// Knots are the partnership markers: tinted by the union's mark, with an additive glow, and
		// an invisible proxy as big as a person's so they can be picked.
		const knotSolid: BufferGeometry[] = [];
		const knotFading: BufferGeometry[] = [];
		const glowPositions: number[] = [];
		const glowColours: number[] = [];
		const glowColour = new Color(RIBBON_TOKENS.glow);
		const lit = new Color();
		for (const u of layout.unions) {
			const mark = highlight.unions.get(u.id);
			// A focus walk marks no unions: a knot is lit plainly when one of its partners is.
			const isPlainLit = !mark && u.partnerIds.some((id) => highlight.people.has(id));
			const alpha = isPlainLit ? 1 : opacityOf(mark, RIBBON_FADE.knot);
			const at = new Vector3(u.x, u.y, u.z);
			const scale = mark
				? mark.isShared
					? RIBBON_SIZES.sharedScale
					: RIBBON_SIZES.litKnotScale
				: 1;
			(alpha >= 1 ? knotSolid : knotFading).push(
				nodeGeometry(
					at,
					RIBBON_SIZES.knot * scale,
					mark ? lit.set(mark.colour).clone() : knotColour,
					alpha
				)
			);
			glowPositions.push(u.x, u.y, u.z);
			const strength = mark || isPlainLit || isQuiet ? alpha : RIBBON_FADE.glow;
			const tint = mark ? lit.set(mark.colour) : glowColour;
			glowColours.push(tint.r * strength, tint.g * strength, tint.b * strength);
			const proxy = new Mesh(pickProxy, proxyMaterial);
			proxy.position.copy(at);
			world.add(proxy);
			stage.trackUnion(u.id, at, u.partnerIds.some(isPrivate) ? null : proxy);
		}
		for (const [parts, isOpaque] of [
			[knotSolid, true],
			[knotFading, false]
		] as const) {
			if (parts.length === 0) continue;
			const merged = mergeGeometries(parts, false);
			for (const part of parts) part.dispose();
			world.add(
				new Mesh(
					merged,
					new MeshBasicMaterial({
						vertexColors: true,
						transparent: !isOpaque,
						depthWrite: isOpaque
					})
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

		// Links: the tubes are merged, so each parent-child line gets an invisible `Line2` along its
		// centreline to be picked through. They share one material and are never drawn.
		const linkByKey = new Map(layout.childLinks.map((link) => [linkKey(link), link]));
		let proxyMaterialLine: LineMaterial | null = null;
		for (const s of layout.strands) {
			if (s.linkKey === null) continue;
			const link = linkByKey.get(s.linkKey)!;
			const centreline = strandCentreline(
				new Vector3(s.from.x, s.from.y, s.from.z),
				new Vector3(s.to.x, s.to.y, s.to.z),
				null
			);
			// An extra entry shares its child's `linkKey` with no one else, so keys never collide.
			const anchor = centreline[LINK_ANCHOR_SAMPLE];
			let line: Line2;
			if (proxyMaterialLine === null) {
				line = stage.thickLine(centreline, '#000000', 1, 1);
				proxyMaterialLine = line.material;
				proxyMaterialLine.visible = false;
			} else {
				const geometry = new LineGeometry();
				geometry.setPositions(centreline.flatMap((v) => [v.x, v.y, v.z]));
				line = new Line2(geometry, proxyMaterialLine);
			}
			world.add(line);
			const isHidden = isPrivate(link.childId) || link.parentIds.some(isPrivate);
			stage.trackLink(s.linkKey, anchor, isHidden ? null : line);
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
