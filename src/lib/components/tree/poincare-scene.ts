/**
 * The WebGL side of the Ball view: a three.js scene drawn from a `PoincareLayout`. The layout is in
 * unit-ball coordinates; everything here scales it by `BALL_RADIUS_UNITS`. `PoincareCanvas.svelte`
 * imports this module dynamically, so three.js is fetched only by someone who opens the view.
 */

import {
	BackSide,
	CanvasTexture,
	Color,
	FrontSide,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	ShaderMaterial,
	Sprite,
	SpriteMaterial,
	SphereGeometry,
	TorusGeometry,
	Vector3,
	type Group
} from 'three';
import { geodesicPoints, type Vec3 } from '#lib/tree-layout/poincare-geodesic.js';
import { linkKey, type Highlight, type Mark } from '#lib/tree-layout/highlight.js';
import type { PoincareLayout } from '#lib/tree-layout/poincare.js';
import { createThreeStage, sexColour } from './three-stage.js';
import {
	HIGHLIGHT_TOKENS,
	POINCARE_TOKENS,
	RING_FADE,
	RING_LINE_WIDTH_PX,
	RING_TOKENS
} from './tree-tokens.js';
import type { WebGlTreeScene } from './webgl-tree.js';

/** Radius of the glass ball in scene units; the layout's unit ball is scaled up to it. */
const BALL_RADIUS_UNITS = 14;
/**
 * Spheres draw at this share of the radius the layout spaced them for. At full size the ones near
 * the axis crowded the opening view; the layout's spacing is kept, so they only gain air.
 */
const SPHERE_DRAW_SCALE = 0.5;
/** A sphere never draws smaller than this, so a person at the glass can still be seen and picked. */
const MIN_SPHERE_RADIUS_UNITS = 0.13;
const FOCUS_SCALE = 1.45;
const HALO_TEXTURE_PX = 128;
const GEODESIC_SEGMENTS = 24;
const YEAR_LABEL_ANGLE = Math.PI / 4;
const LABEL_WIDTH_UNITS = 2.6;
const TAU = Math.PI * 2;

export const POINCARE_CAMERAS = { ANGLED: 'angled', SIDE: 'side', POLE: 'pole' } as const;

const CAMERA_DIRECTIONS = {
	[POINCARE_CAMERAS.ANGLED]: new Vector3(0.62, 0.42, 0.62),
	// Time runs top to bottom.
	[POINCARE_CAMERAS.SIDE]: new Vector3(0, 0.05, 1),
	// Straight down the time axis; a hair off vertical because OrbitControls dislikes the pole.
	[POINCARE_CAMERAS.POLE]: new Vector3(0.001, 1, 0.001)
};

export interface PoincareScene extends WebGlTreeScene {
	/** Rebuild everything from a new layout. `shouldRefit` also resets the camera distance. */
	setLayout(layout: PoincareLayout, highlight: Highlight, shouldRefit: boolean): void;
}

/** A fresnel-ish shell: nearly clear face-on, brighter towards its silhouette. */
function shellMaterial(side: typeof BackSide | typeof FrontSide, base: number, rim: number) {
	return new ShaderMaterial({
		uniforms: {
			uColor: { value: new Color(POINCARE_TOKENS.glass) },
			uBase: { value: base },
			uRim: { value: rim }
		},
		vertexShader: `
			varying vec3 vNormal;
			varying vec3 vView;
			void main() {
				vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
				vNormal = normalize(normalMatrix * normal);
				vView = normalize(-viewPosition.xyz);
				gl_Position = projectionMatrix * viewPosition;
			}`,
		fragmentShader: `
			uniform vec3 uColor;
			uniform float uBase;
			uniform float uRim;
			varying vec3 vNormal;
			varying vec3 vView;
			void main() {
				float edge = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
				gl_FragColor = vec4(uColor, uBase + uRim * pow(edge, 3.0));
			}`,
		transparent: true,
		depthWrite: false,
		side
	});
}

/**
 * @throws when the browser cannot give a WebGL context; the shell shows a message instead.
 */
export function createPoincareScene(host: HTMLElement): PoincareScene {
	const stage = createThreeStage(host, {
		background: POINCARE_TOKENS.stage,
		cameraDirections: CAMERA_DIRECTIONS
	});
	const sphere = stage.share(new SphereGeometry(1, 24, 16));
	const knot = stage.share(new TorusGeometry(1, 0.3, 8, 20));
	/** Hit target for a partnership's marker: as big as a person's sphere, though the knot is small. */
	const unionHit = stage.share(new SphereGeometry(1, 8, 6));

	// The stage frees meshes and lines with each world; sprites and their textures are ours.
	let labelMaterials: SpriteMaterial[] = [];
	let labelTextures: CanvasTexture[] = [];
	// One white ring tinted per halo: a sprite always faces the viewer, so a halo is never edge-on
	// as the flat torus it replaces was from the side camera.
	let haloTexture: CanvasTexture | null = null;
	function haloMap(): CanvasTexture {
		if (haloTexture) return haloTexture;
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = HALO_TEXTURE_PX;
		const context = canvas.getContext('2d');
		if (context) {
			context.strokeStyle = '#ffffff';
			context.lineWidth = HALO_TEXTURE_PX * 0.07;
			context.beginPath();
			context.arc(HALO_TEXTURE_PX / 2, HALO_TEXTURE_PX / 2, HALO_TEXTURE_PX * 0.44, 0, TAU);
			context.stroke();
		}
		haloTexture = new CanvasTexture(canvas);
		return haloTexture;
	}
	function freeLabels() {
		for (const material of labelMaterials) material.dispose();
		for (const texture of labelTextures) texture.dispose();
		labelMaterials = [];
		labelTextures = [];
		haloTexture?.dispose();
		haloTexture = null;
	}

	/** A ring round `at`, `diameter` scene units across, in a mark's colour. */
	function addHalo(world: Group, at: Vector3, diameter: number, colour: string, opacity: number) {
		const material = new SpriteMaterial({
			map: haloMap(),
			color: colour,
			transparent: true,
			opacity,
			// Seen through the glass and through other spheres: a lit person must be findable.
			depthTest: false,
			depthWrite: false
		});
		labelMaterials.push(material);
		const sprite = new Sprite(material);
		sprite.scale.setScalar(diameter);
		sprite.position.copy(at);
		sprite.renderOrder = 20;
		world.add(sprite);
	}

	function yearLabel(year: number, at: Vector3, isMajor: boolean, world: Group) {
		const canvas = document.createElement('canvas');
		canvas.width = 160;
		canvas.height = 56;
		const context = canvas.getContext('2d');
		if (!context) return;
		context.font = `${isMajor ? 600 : 400} 34px system-ui, sans-serif`;
		context.fillStyle = POINCARE_TOKENS.yearInk;
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		context.fillText(String(year), 80, 28);
		const texture = new CanvasTexture(canvas);
		const material = new SpriteMaterial({
			map: texture,
			transparent: true,
			opacity: isMajor ? 0.9 : 0.55,
			depthWrite: false
		});
		labelTextures.push(texture);
		labelMaterials.push(material);
		const sprite = new Sprite(material);
		sprite.scale.set(LABEL_WIDTH_UNITS, (LABEL_WIDTH_UNITS * 56) / 160, 1);
		sprite.position.copy(at);
		world.add(sprite);
	}

	function setLayout(layout: PoincareLayout, highlight: Highlight, shouldRefit: boolean) {
		// No highlight (the viewer cleared it): everyone is drawn plainly, nobody faded.
		const isQuiet = highlight.isQuiet;
		/** A mark's opacity: the soft half of a path is lighter, and everything off it fades. */
		const opacityOf = (mark: Mark | undefined) =>
			mark
				? mark.strength === 'soft'
					? HIGHLIGHT_TOKENS.softOpacity
					: 1
				: isQuiet
					? 1
					: RING_FADE.line;
		const widthOf = (mark: Mark | undefined) =>
			!mark
				? RING_LINE_WIDTH_PX.unlit
				: mark.isShared
					? POINCARE_TOKENS.sharedLinePx
					: RING_LINE_WIDTH_PX.lit;
		freeLabels();
		const world = stage.resetWorld();
		const scale = (v: { x: number; y: number; z: number }) =>
			new Vector3(v.x, v.y, v.z).multiplyScalar(BALL_RADIUS_UNITS);

		// Back face first and front face last, so the faded spheres sort between them.
		const back = new Mesh(
			new SphereGeometry(BALL_RADIUS_UNITS, 64, 48),
			shellMaterial(BackSide, POINCARE_TOKENS.glassOpacity.base, POINCARE_TOKENS.glassOpacity.rim)
		);
		back.renderOrder = -10;
		const front = new Mesh(
			back.geometry,
			shellMaterial(FrontSide, 0, POINCARE_TOKENS.glassOpacity.rim)
		);
		front.renderOrder = 10;
		world.add(back, front);

		world.add(
			stage.hairline(
				[new Vector3(0, -BALL_RADIUS_UNITS, 0), new Vector3(0, BALL_RADIUS_UNITS, 0)],
				POINCARE_TOKENS.latitude,
				POINCARE_TOKENS.latitudeOpacity.axis
			)
		);
		for (const tick of layout.ticks) {
			const ringRadius = Math.sqrt(Math.max(1 - tick.y * tick.y, 0)) * BALL_RADIUS_UNITS;
			const ring: Vector3[] = [];
			for (let i = 0; i <= 96; i++)
				ring.push(
					new Vector3(
						Math.cos((i / 96) * TAU) * ringRadius,
						tick.y * BALL_RADIUS_UNITS,
						Math.sin((i / 96) * TAU) * ringRadius
					)
				);
			world.add(
				stage.hairline(
					ring,
					POINCARE_TOKENS.latitude,
					tick.isMajor
						? POINCARE_TOKENS.latitudeOpacity.major
						: POINCARE_TOKENS.latitudeOpacity.decade
				)
			);
			if (tick.isMajor)
				yearLabel(
					tick.year,
					new Vector3(
						Math.cos(YEAR_LABEL_ANGLE) * ringRadius,
						tick.y * BALL_RADIUS_UNITS,
						Math.sin(YEAR_LABEL_ANGLE) * ringRadius
					),
					true,
					world
				);
		}

		const positions = new Map<string, Vector3>();
		const privateIds = new Set(
			layout.people.filter((p) => p.person.isPrivate === true).map((p) => p.id)
		);
		const drawRadius = new Map<string, number>();
		for (const p of layout.people) {
			const position = scale(p);
			const mark = highlight.people.get(p.id);
			const radius = Math.max(
				p.radius * BALL_RADIUS_UNITS * SPHERE_DRAW_SCALE,
				MIN_SPHERE_RADIUS_UNITS
			);
			drawRadius.set(p.id, radius);
			const isFaded = mark === undefined && !isQuiet;
			const mesh = new Mesh(
				sphere,
				new MeshStandardMaterial({
					color: sexColour(p.person),
					roughness: 0.55,
					metalness: 0.05,
					transparent: isFaded,
					opacity: isFaded ? RING_FADE.person : 1
				})
			);
			mesh.position.copy(position);
			const isFocus = mark?.kind === 'self';
			mesh.scale.setScalar(isFocus ? radius * FOCUS_SCALE : radius);
			if (mark) {
				// The sex fill stays; the mark shows as a ring, and a second one where paths meet.
				const reach = isFocus ? radius * FOCUS_SCALE : radius;
				const opacity = mark.strength === 'soft' ? HIGHLIGHT_TOKENS.softOpacity : 1;
				addHalo(world, position, reach * POINCARE_TOKENS.haloScale, mark.colour, opacity);
				if (mark.isShared)
					addHalo(
						world,
						position,
						reach * POINCARE_TOKENS.sharedHaloScale,
						HIGHLIGHT_TOKENS.intersection,
						opacity
					);
			}
			world.add(mesh);
			stage.track(p.id, position, privateIds.has(p.id) ? null : mesh);
			positions.set(p.id, position);
		}

		const geodesic = (a: Vec3, b: Vec3) =>
			geodesicPoints(a, b, GEODESIC_SEGMENTS).map((p) =>
				new Vector3(...p).multiplyScalar(BALL_RADIUS_UNITS)
			);
		const unitById = new Map(layout.people.map((p): [string, Vec3] => [p.id, [p.x, p.y, p.z]]));
		const unitOf = (id: string) => unitById.get(id)!;

		const unionAt = new Map<string, Vec3>();
		for (const u of layout.unions) {
			unionAt.set(u.id, [u.x, u.y, u.z]);
			const mark = highlight.unions.get(u.id);
			const opacity = opacityOf(mark);
			const colour = mark ? mark.colour : POINCARE_TOKENS.line;
			for (let i = 1; i < u.partnerIds.length; i++)
				world.add(
					stage.thickLine(
						geodesic(unitOf(u.partnerIds[0]), unitOf(u.partnerIds[i])),
						colour,
						opacity,
						widthOf(mark)
					)
				);
			const at = scale(u);
			const marker = new Mesh(
				knot,
				new MeshStandardMaterial({
					color: colour,
					transparent: opacity < 1,
					opacity
				})
			);
			marker.position.copy(at);
			const conformal = 1 - (u.x * u.x + u.y * u.y + u.z * u.z);
			marker.scale.setScalar(
				Math.max(0.5 * conformal * BALL_RADIUS_UNITS * 0.1 * SPHERE_DRAW_SCALE, 0.06)
			);
			world.add(marker);
			if (mark) {
				const bigger = Math.max(...u.partnerIds.map((id) => drawRadius.get(id) ?? 0));
				addHalo(
					world,
					at,
					Math.max(marker.scale.x * 4, bigger) * POINCARE_TOKENS.haloScale,
					mark.colour,
					opacity
				);
				if (mark.isShared)
					addHalo(
						world,
						at,
						Math.max(marker.scale.x * 4, bigger) * POINCARE_TOKENS.sharedHaloScale,
						HIGHLIGHT_TOKENS.intersection,
						opacity
					);
			}
			// The knot is far smaller than a person, so an invisible sphere at least as big as the
			// largest partner stands in for it; the nearer of the two wins a click where they overlap.
			const hitRadius = Math.max(
				...u.partnerIds.map((id) => drawRadius.get(id) ?? MIN_SPHERE_RADIUS_UNITS),
				MIN_SPHERE_RADIUS_UNITS
			);
			const hit = new Mesh(unionHit, new MeshBasicMaterial({ visible: false }));
			hit.position.copy(at);
			hit.scale.setScalar(hitRadius);
			world.add(hit);
			stage.trackUnion(u.id, at, u.partnerIds.some((id) => privateIds.has(id)) ? null : hit);
		}

		for (const link of layout.childLinks) {
			const from =
				link.fromUnionId !== null ? unionAt.get(link.fromUnionId) : unitOf(link.fromPersonId!);
			if (!from || !positions.has(link.childId)) continue;
			const key = linkKey(link);
			const mark = highlight.links.get(key);
			const points = geodesic(from, unitOf(link.childId));
			const line = stage.thickLine(
				points,
				mark ? mark.colour : POINCARE_TOKENS.line,
				opacityOf(mark),
				widthOf(mark)
			);
			world.add(line);
			const isHidden =
				privateIds.has(link.childId) || link.parentIds.some((id) => privateIds.has(id));
			stage.trackLink(key, points[points.length >> 1], isHidden ? null : line);
		}

		// The whole ball is framed, whoever is in it: the glass is what the eye settles on.
		const hull: Vector3[] = [];
		const reach = BALL_RADIUS_UNITS * 1.04;
		for (const x of [-1, 0, 1])
			for (const y of [-1, 0, 1])
				for (const z of [-1, 0, 1])
					if (x !== 0 || y !== 0 || z !== 0)
						hull.push(new Vector3(x, y, z).normalize().multiplyScalar(reach));
		stage.frame(hull, new Vector3(0, 0, 0), shouldRefit);
	}

	return {
		...stage.handle,
		setLayout,
		dispose() {
			freeLabels();
			stage.handle.dispose();
		}
	};
}
