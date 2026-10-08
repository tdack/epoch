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
import type { PoincareLayout } from '#lib/tree-layout/poincare.js';
import { createThreeStage, sexColour } from './three-stage.js';
import { POINCARE_TOKENS, RING_FADE, RING_LINE_WIDTH_PX, RING_TOKENS } from './tree-tokens.js';
import type { TreeRole, WebGlTreeScene } from './webgl-tree.js';

/** Radius of the glass ball in scene units; the layout's unit ball is scaled up to it. */
const BALL_RADIUS_UNITS = 14;
/** A sphere never draws smaller than this, so a person at the glass can still be seen and picked. */
const MIN_SPHERE_RADIUS_UNITS = 0.13;
const FOCUS_SCALE = 1.45;
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
	setLayout(layout: PoincareLayout, roles: Map<string, TreeRole>, shouldRefit: boolean): void;
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
	const halo = stage.share(new TorusGeometry(1, 0.06, 8, 40));

	// The stage frees meshes and lines with each world; sprites and their textures are ours.
	let labelMaterials: SpriteMaterial[] = [];
	let labelTextures: CanvasTexture[] = [];
	function freeLabels() {
		for (const material of labelMaterials) material.dispose();
		for (const texture of labelTextures) texture.dispose();
		labelMaterials = [];
		labelTextures = [];
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

	function setLayout(layout: PoincareLayout, roles: Map<string, TreeRole>, shouldRefit: boolean) {
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
		for (const p of layout.people) {
			const position = scale(p);
			const role = roles.get(p.id) ?? null;
			const radius = Math.max(p.radius * BALL_RADIUS_UNITS, MIN_SPHERE_RADIUS_UNITS);
			const mesh = new Mesh(
				sphere,
				new MeshStandardMaterial({
					color: sexColour(p.person),
					roughness: 0.55,
					metalness: 0.05,
					transparent: role === null,
					opacity: role === null ? RING_FADE.person : 1
				})
			);
			mesh.position.copy(position);
			mesh.scale.setScalar(role === 'focus' ? radius * FOCUS_SCALE : radius);
			if (role === 'focus') {
				const focusHalo = new Mesh(halo, new MeshBasicMaterial({ color: RING_TOKENS.focus }));
				focusHalo.position.copy(position);
				focusHalo.scale.setScalar(radius * FOCUS_SCALE * 1.45);
				// Faces the viewer on the angled and side presets, which are the ones people start in.
				focusHalo.rotation.x = Math.PI / 2;
				world.add(focusHalo);
			}
			world.add(mesh);
			stage.track(p.id, position, p.person.isPrivate === true ? null : mesh);
			positions.set(p.id, position);
		}

		const isOnLine = (id: string) => {
			const role = roles.get(id);
			return role === 'focus' || role === 'ancestor' || role === 'descendant';
		};
		const geodesic = (a: Vec3, b: Vec3) =>
			geodesicPoints(a, b, GEODESIC_SEGMENTS).map((p) =>
				new Vector3(...p).multiplyScalar(BALL_RADIUS_UNITS)
			);
		const unitById = new Map(layout.people.map((p): [string, Vec3] => [p.id, [p.x, p.y, p.z]]));
		const unitOf = (id: string) => unitById.get(id)!;

		const unionAt = new Map<string, Vec3>();
		for (const u of layout.unions) {
			unionAt.set(u.id, [u.x, u.y, u.z]);
			const isLit = u.partnerIds.some(isOnLine);
			if (u.partnerIds.length > 1)
				for (let i = 1; i < u.partnerIds.length; i++)
					world.add(
						stage.thickLine(
							geodesic(unitOf(u.partnerIds[0]), unitOf(u.partnerIds[i])),
							isLit ? RING_TOKENS.partner : RING_TOKENS.line,
							isLit ? 1 : RING_FADE.line,
							isLit ? RING_LINE_WIDTH_PX.lit : RING_LINE_WIDTH_PX.unlit
						)
					);
			const marker = new Mesh(
				knot,
				new MeshStandardMaterial({
					color: isLit ? RING_TOKENS.partner : RING_TOKENS.line,
					transparent: !isLit,
					opacity: isLit ? 1 : RING_FADE.line
				})
			);
			marker.position.copy(scale(u));
			const conformal = 1 - (u.x * u.x + u.y * u.y + u.z * u.z);
			marker.scale.setScalar(Math.max(0.5 * conformal * BALL_RADIUS_UNITS * 0.1, 0.06));
			world.add(marker);
		}

		for (const link of layout.childLinks) {
			const from =
				link.fromUnionId !== null ? unionAt.get(link.fromUnionId) : unitOf(link.fromPersonId!);
			if (!from || !positions.has(link.childId)) continue;
			const childRole = roles.get(link.childId) ?? null;
			const isLit =
				(childRole === 'descendant' && link.parentIds.some(isOnLine)) ||
				((childRole === 'focus' || childRole === 'ancestor') &&
					link.parentIds.some((id) => roles.get(id) === 'ancestor'));
			world.add(
				stage.thickLine(
					geodesic(from, unitOf(link.childId)),
					!isLit
						? RING_TOKENS.line
						: childRole === 'descendant'
							? RING_TOKENS.descendant
							: RING_TOKENS.ancestor,
					isLit ? 1 : RING_FADE.line,
					isLit ? RING_LINE_WIDTH_PX.lit : RING_LINE_WIDTH_PX.unlit
				)
			);
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
