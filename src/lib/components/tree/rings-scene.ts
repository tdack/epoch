/**
 * The WebGL side of the rings overview (ADR-032): a three.js scene drawn from a `RingsLayout`, with
 * orbit controls and picking. `RingsCanvas.svelte` imports this module dynamically, so three.js is
 * fetched only by someone who opens Rings, and the component keeps the DOM (names, controls).
 */

import {
	BufferGeometry,
	Color,
	CubicBezierCurve3,
	DirectionalLight,
	Group,
	HemisphereLight,
	Line,
	LineBasicMaterial,
	Mesh,
	MeshStandardMaterial,
	PerspectiveCamera,
	Raycaster,
	Scene,
	SphereGeometry,
	TorusGeometry,
	Vector2,
	Vector3,
	WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { RingsLayout } from '#lib/tree-layout/rings.js';
import { RING_FADE, RING_TOKENS } from './tree-tokens.js';

/** Vertical distance between two generation rings, in scene units. */
export const RING_GAP_UNITS = 6.5;
const SPHERE_RADIUS_UNITS = 0.34;
const FOCUS_SCALE = 1.45;
/** How far the knot a partnership's lines leave from hangs below its partners. */
const UNION_DROP_UNITS = 0.45;
const TAU = Math.PI * 2;
/** Room left round the rings when framing, as a multiple of what they need. */
const FRAME_MARGIN = 1.2;
const RING_MIN_FRAME_UNITS = 3;

export const RING_CAMERAS = { ANGLED: 'angled', SIDE: 'side', ABOVE: 'above' } as const;
export type RingCamera = (typeof RING_CAMERAS)[keyof typeof RING_CAMERAS];

/** Direction from the target to the camera for each preset; the distance comes from the layout. */
const CAMERA_DIRECTIONS: Record<RingCamera, Vector3> = {
	angled: new Vector3(0.62, 0.42, 0.62).normalize(),
	side: new Vector3(0, 0.05, 1).normalize(),
	// Straight down the trunk turns the rings into concentric circles, a fan chart for free.
	above: new Vector3(0.001, 1, 0.001).normalize()
};

/** What a sphere or line stands for on the focus person's line; null is everyone else. */
export type RingRole = 'focus' | 'ancestor' | 'descendant' | 'partner' | null;

export interface RingsScene {
	/** Rebuild everything from a new layout. `shouldRefit` also resets the camera distance. */
	setLayout(layout: RingsLayout, roles: Map<string, RingRole>, shouldRefit: boolean): void;
	setCamera(preset: RingCamera): void;
	setSpinning(isSpinning: boolean): void;
	/** The person under a viewport point, or null. Private people are never picked. */
	pick(clientX: number, clientY: number): string | null;
	/** Where a person lands in the canvas, in CSS pixels; null when behind the camera or off it. */
	project(personId: string): { x: number; y: number } | null;
	/** Called after each drawn frame, so the component can move its DOM names with the scene. */
	onFrame(callback: () => void): void;
	dispose(): void;
}

export function ringPosition(generation: number, radius: number, angle: number): Vector3 {
	return new Vector3(
		Math.cos(angle) * radius,
		-generation * RING_GAP_UNITS,
		Math.sin(angle) * radius
	);
}

/**
 * @throws when the browser cannot give a WebGL context; the component shows a message instead.
 */
export function createRingsScene(host: HTMLElement): RingsScene {
	const renderer = new WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.domElement.style.display = 'block';
	host.appendChild(renderer.domElement);

	const scene = new Scene();
	scene.background = new Color(RING_TOKENS.stage);
	const camera = new PerspectiveCamera(42, 1, 0.1, 2000);
	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.autoRotateSpeed = 0.6;
	scene.add(new HemisphereLight(0xffffff, 0x8a8478, 1.1));
	const sun = new DirectionalLight(0xffffff, 0.9);
	sun.position.set(10, 30, 20);
	scene.add(sun);

	const sphere = new SphereGeometry(SPHERE_RADIUS_UNITS, 24, 16);
	const knot = new TorusGeometry(0.16, 0.05, 8, 20);
	let world = new Group();
	scene.add(world);
	const meshes = new Map<string, Mesh>();
	const positions = new Map<string, Vector3>();
	/** What the camera must take in: the rings' vertical span and the widest ring. */
	let bounds = { top: 0, bottom: 0, radius: RING_MIN_FRAME_UNITS };
	let preset: RingCamera = RING_CAMERAS.ANGLED;
	const frameCallbacks: Array<() => void> = [];

	function disposeWorld() {
		world.traverse((object) => {
			if (object instanceof Mesh || object instanceof Line) {
				(object.material as LineBasicMaterial).dispose();
				if (object.geometry !== sphere && object.geometry !== knot) object.geometry.dispose();
			}
		});
		scene.remove(world);
		meshes.clear();
		positions.clear();
	}

	const tint = (role: RingRole) =>
		role === 'focus'
			? RING_TOKENS.focus
			: role === 'ancestor'
				? RING_TOKENS.ancestor
				: role === 'descendant'
					? RING_TOKENS.descendant
					: role === 'partner'
						? RING_TOKENS.partner
						: RING_TOKENS.other;

	function line(points: Vector3[], colour: string, opacity: number): Line {
		return new Line(
			new BufferGeometry().setFromPoints(points),
			new LineBasicMaterial({ color: colour, transparent: opacity < 1, opacity })
		);
	}

	/**
	 * Frames every ring, not just the focus person's: the target is the middle of the stack, and the
	 * distance is the larger of what the height and the widest ring need through this lens.
	 */
	function fit() {
		const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
		const halfHeight = (bounds.top - bounds.bottom) / 2;
		const fitWidth = (bounds.radius * FRAME_MARGIN) / (tanHalf * camera.aspect);
		const distance =
			preset === RING_CAMERAS.ABOVE
				? Math.max((bounds.radius * FRAME_MARGIN) / tanHalf, fitWidth) + halfHeight
				: Math.max(((halfHeight + bounds.radius * 0.5) * FRAME_MARGIN) / tanHalf, fitWidth) +
					bounds.radius;
		controls.target.set(0, (bounds.top + bounds.bottom) / 2, 0);
		camera.position.copy(controls.target).addScaledVector(CAMERA_DIRECTIONS[preset], distance);
		controls.update();
	}

	function setLayout(layout: RingsLayout, roles: Map<string, RingRole>, shouldRefit: boolean) {
		disposeWorld();
		world = new Group();
		scene.add(world);

		for (const ring of layout.rings) {
			const points: Vector3[] = [];
			for (let i = 0; i <= 128; i++)
				points.push(ringPosition(ring.generation, ring.radius, (i / 128) * TAU));
			world.add(line(points, RING_TOKENS.ring, RING_FADE.ring));
		}

		for (const p of layout.people) {
			const position = ringPosition(p.generation, p.radius, p.angle);
			const role = roles.get(p.id) ?? null;
			const isPrivate = p.person.isPrivate === true;
			const mesh = new Mesh(
				sphere,
				new MeshStandardMaterial({
					color: isPrivate ? RING_TOKENS.private : tint(role),
					roughness: 0.55,
					metalness: 0.05,
					transparent: role === null,
					opacity: role === null ? RING_FADE.person : 1
				})
			);
			mesh.position.copy(position);
			if (role === 'focus') mesh.scale.setScalar(FOCUS_SCALE);
			if (!isPrivate) mesh.userData.personId = p.id;
			world.add(mesh);
			meshes.set(p.id, mesh);
			positions.set(p.id, position);
		}

		const isOnLine = (id: string) => {
			const role = roles.get(id);
			return role === 'focus' || role === 'ancestor' || role === 'descendant';
		};
		const unionAt = new Map<string, Vector3>();
		for (const u of layout.unions) {
			const at = ringPosition(u.generation, u.radius, u.angle).add(
				new Vector3(0, -UNION_DROP_UNITS, 0)
			);
			unionAt.set(u.id, at);
			const isLit = u.partnerIds.some(isOnLine);
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
					line(points, isLit ? RING_TOKENS.partner : RING_TOKENS.line, isLit ? 1 : RING_FADE.line)
				);
			}
			const marker = new Mesh(
				knot,
				new MeshStandardMaterial({
					color: isLit ? RING_TOKENS.partner : RING_TOKENS.line,
					transparent: !isLit,
					opacity: isLit ? 1 : RING_FADE.line
				})
			);
			marker.position.copy(at);
			marker.rotation.x = Math.PI / 2;
			world.add(marker);
		}

		for (const link of layout.childLinks) {
			const from =
				link.fromUnionId !== null
					? unionAt.get(link.fromUnionId)
					: positions.get(link.fromPersonId!);
			const to = positions.get(link.childId);
			if (!from || !to) continue;
			const childRole = roles.get(link.childId) ?? null;
			const isLit =
				(childRole === 'descendant' && link.parentIds.some(isOnLine)) ||
				((childRole === 'focus' || childRole === 'ancestor') &&
					link.parentIds.some((id) => roles.get(id) === 'ancestor'));
			const drop = (to.y - from.y) / 2;
			const curve = new CubicBezierCurve3(
				from,
				from.clone().add(new Vector3(0, drop, 0)),
				to.clone().add(new Vector3(0, -drop, 0)),
				to
			);
			world.add(
				line(
					curve.getPoints(24),
					!isLit
						? RING_TOKENS.line
						: childRole === 'descendant'
							? RING_TOKENS.descendant
							: RING_TOKENS.ancestor,
					isLit ? 1 : RING_FADE.line
				)
			);
		}

		const ys = layout.rings.map((r) => -r.generation * RING_GAP_UNITS);
		bounds = {
			top: ys.length > 0 ? Math.max(...ys) : 0,
			bottom: ys.length > 0 ? Math.min(...ys) : 0,
			radius: Math.max(RING_MIN_FRAME_UNITS, ...layout.rings.map((r) => r.radius))
		};
		if (shouldRefit) fit();
	}

	const raycaster = new Raycaster();
	const pointer = new Vector2();
	function pick(clientX: number, clientY: number): string | null {
		const rect = renderer.domElement.getBoundingClientRect();
		pointer.set(
			((clientX - rect.left) / rect.width) * 2 - 1,
			-((clientY - rect.top) / rect.height) * 2 + 1
		);
		raycaster.setFromCamera(pointer, camera);
		const hit = raycaster
			.intersectObjects([...meshes.values()], false)
			.find((h) => h.object.userData.personId !== undefined);
		return hit ? (hit.object.userData.personId as string) : null;
	}

	const projected = new Vector3();
	function project(personId: string): { x: number; y: number } | null {
		const position = positions.get(personId);
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
	}
	const observer = new ResizeObserver(resize);
	observer.observe(host);
	resize();

	let frame = 0;
	const loop = () => {
		frame = requestAnimationFrame(loop);
		controls.update();
		renderer.render(scene, camera);
		for (const callback of frameCallbacks) callback();
	};
	frame = requestAnimationFrame(loop);

	return {
		setLayout,
		setCamera(next) {
			preset = next;
			fit();
		},
		setSpinning(isSpinning) {
			controls.autoRotate = isSpinning;
		},
		pick,
		project,
		onFrame(callback) {
			frameCallbacks.push(callback);
		},
		dispose() {
			cancelAnimationFrame(frame);
			observer.disconnect();
			disposeWorld();
			sphere.dispose();
			knot.dispose();
			controls.dispose();
			renderer.dispose();
			renderer.domElement.remove();
		}
	};
}
