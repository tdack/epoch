/**
 * The mode-independent half of the WebGL tree views (ADR-032 and the Ball, Ribbons and Orrery
 * views): the renderer, camera and orbit controls, an on-demand frame loop, picking, projection to
 * CSS pixels, line helpers and camera framing. A mode's `*-scene.ts` builds its meshes inside the
 * `world` group this hands out and returns the stage's `handle` beside its own `setLayout`.
 *
 * `WebGlTreeShell.svelte` imports a mode's scene module dynamically, so three.js is fetched only by
 * someone who opens a WebGL view. This module is only ever imported from those scene modules.
 */

import {
	BufferGeometry,
	Color,
	Float32BufferAttribute,
	DirectionalLight,
	Group,
	HemisphereLight,
	Line,
	LineBasicMaterial,
	Mesh,
	Object3D,
	Points,
	PointsMaterial,
	PerspectiveCamera,
	Raycaster,
	Scene,
	Sprite,
	Vector2,
	Vector3,
	WebGLRenderer,
	type Material
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { RelationshipGraphPerson } from '#lib/tree-layout/types.js';
import type { PickOptions, PickTarget, WebGlTreeScene } from './webgl-tree.js';
import { DEFAULT_PALETTE, type Palette } from './palette.js';
import { starField } from './star-field.js';

/** How much of the canvas the framed content may fill, in clip space (1 is edge to edge). */
const FRAME_FILL = 0.88;
const FIELD_OF_VIEW_DEGREES = 42;
const FAR_PLANE_UNITS = 5000;
/** Inside the far plane, and far enough beyond any framed tree that it never reads as part of it. */
const STAR_SHELL_UNITS = 3500;
const STAR_COUNT = 700;
/** Only a dark stage gets stars: on the cream stage they would be dirt. */
const MAX_STAR_STAGE_LIGHTNESS = 0.25;
/** Halvings of the framing search; 40 narrows the far plane's range far below a pixel. */
const FRAME_SEARCH_STEPS = 40;
/**
 * How near a pointer must come to a parent-child line to pick it, in CSS pixels either side of the
 * line's centre. A fingertip is far less exact than a mouse, so coarse pointers get twice that.
 */
const LINE_PICK_RADIUS_PX = 6;
const COARSE_LINE_PICK_RADIUS_PX = 12;
/**
 * Spheres and partnership markers are solid, so they win over lines; a line is picked only where
 * no solid is under the pointer, because its pick band is several pixels wide and a click on a
 * sphere that a line runs into must pick the sphere. Among solids under the pointer, the one whose
 * centre is nearest the pointer on screen wins, not the one nearest the camera: a partnership's
 * marker sits at its partners' midpoint, and a large star in front of it (the focus, or a partner
 * orbiting past) would otherwise take every click aimed squarely at the marker.
 */
const PICK_PRIORITY: Record<PickTarget['kind'], number> = { person: 0, union: 0, link: 1 };

/** Colour of a person's sphere or tube: by sex, with private people a plain neutral. */
export function sexColour(
	person: RelationshipGraphPerson,
	palette: Palette = DEFAULT_PALETTE
): string {
	if (person.isPrivate === true) return palette.private;
	return person.sex === 'M'
		? palette.sex.male.sphere
		: person.sex === 'F'
			? palette.sex.female.sphere
			: palette.sex.unknown.sphere;
}

function makeStars(): Points {
	const { positions, colours } = starField(STAR_COUNT, STAR_SHELL_UNITS);
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
	geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
	// Fixed pixel size, not attenuated: a star a few thousand units away would otherwise vanish. The
	// ratio keeps them the same CSS size on a dense screen.
	const material = new PointsMaterial({
		size: 1.5 * Math.min(window.devicePixelRatio, 2),
		sizeAttenuation: false,
		vertexColors: true,
		transparent: true,
		opacity: 0.85,
		depthWrite: false,
		fog: false
	});
	const points = new Points(geometry, material);
	// Centred on the camera, so the bounding sphere three computes (round the origin) is wrong.
	points.frustumCulled = false;
	// Behind everything the tree draws.
	points.renderOrder = -1;
	return points;
}

export interface StageOptions {
	/** Canvas background, a hex string. */
	background: string;
	/**
	 * Direction from the framing target to the camera for each named preset (normalised here); the
	 * distance comes from the content being framed. The first entry is the starting preset.
	 */
	cameraDirections: Record<string, Vector3>;
	/** OrbitControls' `autoRotateSpeed` for Spin; 2 is one turn in 30 seconds, and the default here is 0.6. */
	spinSpeed?: number;
}

export interface ThreeStage {
	/** For the mode to add its own lights, helpers or backdrop to. Disposed with the stage. */
	scene: Scene;
	camera: PerspectiveCamera;
	controls: OrbitControls;
	renderer: WebGLRenderer;
	/** The CSS pixel size of the canvas now. */
	size(): { width: number; height: number };
	/**
	 * Throws away the previous world (every material and geometry in it, except those passed to
	 * {@link ThreeStage.share}) and returns a new empty group to build the next one in. Call at the
	 * start of `setLayout`.
	 */
	resetWorld(): Group;
	/** Marks a geometry as reused across rebuilds so `resetWorld` leaves it alone. */
	share<T extends BufferGeometry>(geometry: T): T;
	/**
	 * Makes a person pickable and projectable. Pass their mesh to pick it and the position names
	 * should follow; pass `null` for a private person, who is projected for nothing and never
	 * picked. `position` is kept by reference, so an animated position that mutates the same
	 * vector is followed without calling this again.
	 */
	track(personId: string, position: Vector3, pickable: Mesh | null): void;
	/**
	 * Makes a partnership's marker pickable and projectable, like {@link ThreeStage.track}. Opt in:
	 * a scene that never calls this has no pickable partnerships. `pickable` may be any object
	 * (a group of meshes, an invisible proxy for a merged draw call), and null makes it unpickable,
	 * as it must be when a private person is a partner.
	 */
	trackUnion(unionId: string, position: Vector3, pickable: Object3D | null): void;
	/**
	 * Makes a parent-child line pickable; `key` is the layout's `linkKey`. `anchor` is a point on the
	 * line (its midpoint, say) where tests can find it, and `pickable` is the `Line2` from
	 * {@link ThreeStage.thickLine}, or any proxy object when the line is merged into a larger draw.
	 * Pass null when the child or a parent is private: such a line is never picked.
	 */
	trackLink(key: string, anchor: Vector3, pickable: Object3D | null): void;
	/** A thin, single-pixel line; the rim of a disc, say. */
	hairline(points: Vector3[], colour: string, opacity: number): Line;
	/**
	 * A line drawn `widthPx` wide whatever the distance. WebGL draws plain lines one pixel wide on
	 * most platforms, too thin for the lines that carry the focus person's line.
	 */
	thickLine(points: Vector3[], colour: string, opacity: number, widthPx: number): Line2;
	/**
	 * Aims at `target` and finds, by halving, the nearest distance along the current preset at which
	 * every point still fits the canvas. Remembered, so changing preset re-frames the same content.
	 * With `shouldMove` false it only remembers, for a rebuild that must keep the user's view.
	 */
	frame(points: Vector3[], target: Vector3, shouldMove?: boolean): void;
	/**
	 * Runs before each rendered frame with the time in milliseconds. Return true when it changed
	 * something, so a still scene still costs nothing.
	 */
	addAnimator(animator: (timeMs: number) => boolean): void;
	/** What `WebGlTreeShell` drives: spread it into the scene object a mode returns. */
	handle: WebGlTreeScene;
	dispose(): void;
}

/**
 * @throws when the browser cannot give a WebGL context; the shell shows a message instead.
 */
export function createThreeStage(host: HTMLElement, options: StageOptions): ThreeStage {
	const renderer = new WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.domElement.style.display = 'block';
	host.appendChild(renderer.domElement);

	const scene = new Scene();
	const backgroundColour = new Color(options.background);
	scene.background = backgroundColour;
	const stars =
		backgroundColour.getHSL({ h: 0, s: 0, l: 0 }).l <= MAX_STAR_STAGE_LIGHTNESS
			? makeStars()
			: null;
	if (stars) scene.add(stars);
	const camera = new PerspectiveCamera(FIELD_OF_VIEW_DEGREES, 1, 0.1, FAR_PLANE_UNITS);
	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.autoRotateSpeed = options.spinSpeed ?? 0.6;
	// Zoom and pan are applied inside the controls' own event handlers, so the loop's update() then
	// sees nothing left to do; without this they waited for the damping tail to be drawn.
	controls.addEventListener('change', () => (isDirty = true));
	scene.add(new HemisphereLight(0xffffff, 0x8a8478, 1.1));
	const sun = new DirectionalLight(0xffffff, 0.9);
	sun.position.set(10, 30, 20);
	scene.add(sun);

	const directions = new Map(
		Object.entries(options.cameraDirections).map(([id, v]) => [id, v.clone().normalize()])
	);
	let preset = Object.keys(options.cameraDirections)[0];
	let framed: { points: Vector3[]; target: Vector3 } | null = null;

	/** Fat-line materials draw in pixels, so each needs the canvas size and is told on resize. */
	const lineMaterials = new Set<LineMaterial>();
	const sharedGeometries = new Set<BufferGeometry>();
	let world = new Group();
	scene.add(world);
	const positions = new Map<string, Vector3>();
	/** Keyed by `kind:id`, so a person, a partnership and a line never collide. */
	const pickables = new Map<string, Object3D>();
	const frameCallbacks: Array<() => void> = [];
	const animators: Array<(timeMs: number) => boolean> = [];
	let isDirty = true;

	function disposeWorld() {
		world.traverse((object) => {
			if (!(
				object instanceof Mesh ||
				object instanceof Line ||
				object instanceof Points ||
				object instanceof Sprite
			))
				return;
			const material = object.material as Material | Material[];
			for (const m of Array.isArray(material) ? material : [material]) m.dispose();
			// Every sprite draws three.js's one module-level quad, so freeing it would pull it from
			// under the sprites of the next world.
			if (object instanceof Sprite) return;
			if (!sharedGeometries.has(object.geometry)) object.geometry.dispose();
		});
		scene.remove(world);
		positions.clear();
		pickables.clear();
		lineMaterials.clear();
	}

	function frame(points: Vector3[], target: Vector3, shouldMove = true) {
		framed = { points, target };
		if (!shouldMove) return;
		controls.target.copy(target);
		const probe = new Vector3();
		const direction = directions.get(preset)!;
		const fits = (distance: number) => {
			camera.position.copy(controls.target).addScaledVector(direction, distance);
			camera.lookAt(controls.target);
			camera.updateMatrixWorld();
			return points.every((point) => {
				probe.copy(point).project(camera);
				return probe.z < 1 && Math.abs(probe.x) <= FRAME_FILL && Math.abs(probe.y) <= FRAME_FILL;
			});
		};
		// Searched inside the camera's far plane: beyond it nothing "fits", which would push the
		// search the wrong way. A closed form over-framed badly once content was taller than wide.
		let near = 1;
		let far = camera.far * 0.9;
		for (let i = 0; i < FRAME_SEARCH_STEPS; i++) {
			const mid = (near + far) / 2;
			if (fits(mid)) far = mid;
			else near = mid;
		}
		fits(far);
		controls.update();
		isDirty = true;
	}

	const raycaster = new Raycaster();
	const pointer = new Vector2();
	const targetOf = (object: Object3D | null): PickTarget | null => {
		for (let node = object; node; node = node.parent)
			if (node.userData.pick) return node.userData.pick as PickTarget;
		return null;
	};
	/**
	 * What is under a viewport point, or null: the nearest sphere or partnership marker, else a line. Private people are never picked. The
	 * order matters because a line's pick band is several pixels wide, and clicking a sphere that a
	 * line runs into must pick the sphere.
	 */
	function pick(clientX: number, clientY: number, options: PickOptions = {}): PickTarget | null {
		const rect = renderer.domElement.getBoundingClientRect();
		pointer.set(
			((clientX - rect.left) / rect.width) * 2 - 1,
			-((clientY - rect.top) / rect.height) * 2 + 1
		);
		raycaster.setFromCamera(pointer, camera);
		// Line2 reads its threshold as extra width in pixels, of which half falls either side.
		raycaster.params.Line2 = {
			threshold: 2 * (options.isCoarse ? COARSE_LINE_PICK_RADIUS_PX : LINE_PICK_RADIUS_PX)
		};
		const pointerX = clientX - rect.left;
		const pointerY = clientY - rect.top;
		/** Screen distance from the pointer to the target's centre; depth breaks ties for lines. */
		const offsetOf = (target: PickTarget, depth: number) => {
			if (target.kind === 'link') return depth;
			const at = project(target);
			return at ? Math.hypot(at.x - pointerX, at.y - pointerY) : Number.POSITIVE_INFINITY;
		};
		let best: { target: PickTarget; offset: number } | null = null;
		for (const hit of raycaster.intersectObjects([...pickables.values()], true)) {
			const target = targetOf(hit.object);
			if (!target) continue;
			const offset = offsetOf(target, hit.distance);
			if (
				!best ||
				PICK_PRIORITY[target.kind] < PICK_PRIORITY[best.target.kind] ||
				(PICK_PRIORITY[target.kind] === PICK_PRIORITY[best.target.kind] && offset < best.offset)
			)
				best = { target, offset };
		}
		return best?.target ?? null;
	}

	const projected = new Vector3();
	/** Where a person lands in the canvas, in CSS pixels; null when behind the camera or off it. */
	function project(target: PickTarget): { x: number; y: number } | null {
		const position = positions.get(`${target.kind}:${target.id}`);
		if (!position) return null;
		projected.copy(position).project(camera);
		if (projected.z > 1 || Math.abs(projected.x) > 1.05 || Math.abs(projected.y) > 1.05)
			return null;
		return {
			x: ((projected.x + 1) / 2) * host.clientWidth,
			y: ((1 - projected.y) / 2) * host.clientHeight
		};
	}

	function resize() {
		const width = host.clientWidth;
		const height = host.clientHeight;
		if (width === 0 || height === 0) return;
		renderer.setSize(width, height);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		for (const material of lineMaterials) material.resolution.set(width, height);
		isDirty = true;
	}
	const observer = new ResizeObserver(resize);
	observer.observe(host);
	resize();

	// Drawn only when something moved: a still scene costs nothing, and the names (DOM, moved by the
	// frame callbacks) are repositioned only when their spheres could have.
	let frameHandle = 0;
	const loop = (timeMs: number) => {
		frameHandle = requestAnimationFrame(loop);
		let didAnimate = false;
		for (const animator of animators) didAnimate = animator(timeMs) || didAnimate;
		const didMove = controls.update();
		if (!didMove && !didAnimate && !isDirty) return;
		isDirty = false;
		// Pinned to the camera so the shell is always the same distance away; only rotation moves the stars.
		stars?.position.copy(camera.position);
		renderer.render(scene, camera);
		for (const callback of frameCallbacks) callback();
	};
	frameHandle = requestAnimationFrame(loop);

	const handle: WebGlTreeScene = {
		setCamera(next) {
			if (!directions.has(next)) return;
			preset = next;
			if (framed) frame(framed.points, framed.target);
		},
		setSpinning(isSpinning) {
			controls.autoRotate = isSpinning;
		},
		requestFrame() {
			isDirty = true;
		},
		pick,
		project,
		targets() {
			return [...pickables.values()]
				.map((object) => object.userData.pick as PickTarget)
				.filter((target) => target.kind !== 'person');
		},
		onFrame(callback) {
			frameCallbacks.push(callback);
		},
		dispose() {
			cancelAnimationFrame(frameHandle);
			observer.disconnect();
			disposeWorld();
			for (const geometry of sharedGeometries) geometry.dispose();
			if (stars) {
				stars.geometry.dispose();
				(stars.material as Material).dispose();
			}
			controls.dispose();
			renderer.dispose();
			renderer.domElement.remove();
		}
	};

	return {
		scene,
		camera,
		controls,
		renderer,
		size: () => ({ width: host.clientWidth, height: host.clientHeight }),
		resetWorld() {
			disposeWorld();
			world = new Group();
			scene.add(world);
			isDirty = true;
			return world;
		},
		share(geometry) {
			sharedGeometries.add(geometry);
			return geometry;
		},
		track(personId, position, mesh) {
			positions.set(`person:${personId}`, position);
			if (mesh) {
				mesh.userData.pick = { kind: 'person', id: personId } satisfies PickTarget;
				pickables.set(`person:${personId}`, mesh);
			}
		},
		trackUnion(unionId, position, object) {
			positions.set(`union:${unionId}`, position);
			if (object) {
				object.userData.pick = { kind: 'union', id: unionId } satisfies PickTarget;
				pickables.set(`union:${unionId}`, object);
			}
		},
		trackLink(key, anchor, object) {
			positions.set(`link:${key}`, anchor);
			if (object) {
				object.userData.pick = { kind: 'link', id: key } satisfies PickTarget;
				pickables.set(`link:${key}`, object);
			}
		},
		hairline(points, colour, opacity) {
			return new Line(
				new BufferGeometry().setFromPoints(points),
				new LineBasicMaterial({ color: colour, transparent: opacity < 1, opacity })
			);
		},
		thickLine(points, colour, opacity, widthPx) {
			const geometry = new LineGeometry();
			geometry.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
			const material = new LineMaterial({
				color: colour,
				linewidth: widthPx,
				transparent: opacity < 1,
				opacity
			});
			material.resolution.set(host.clientWidth, host.clientHeight);
			lineMaterials.add(material);
			return new Line2(geometry, material);
		},
		frame,
		addAnimator(animator) {
			animators.push(animator);
		},
		handle,
		dispose: handle.dispose
	};
}
