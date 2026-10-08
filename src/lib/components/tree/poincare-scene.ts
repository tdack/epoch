/**
 * The WebGL side of the Ball view: a three.js scene drawn from a `PoincareLayout`. A stub for now,
 * a sphere per person on the shared stage. `PoincareCanvas.svelte` imports this module dynamically,
 * so three.js is fetched only by someone who opens the view.
 */

import { Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three';
import type { PoincareLayout } from '#lib/tree-layout/poincare.js';
import { createThreeStage, sexColour } from './three-stage.js';
import { POINCARE_TOKENS } from './tree-tokens.js';
import type { TreeRole, WebGlTreeScene } from './webgl-tree.js';

const SPHERE_RADIUS_UNITS = 0.5;
const FOCUS_SCALE = 1.45;

export const POINCARE_CAMERAS = { ANGLED: 'angled', SIDE: 'side' } as const;

export interface PoincareScene extends WebGlTreeScene {
	/** Rebuild everything from a new layout. `shouldRefit` also resets the camera distance. */
	setLayout(layout: PoincareLayout, roles: Map<string, TreeRole>, shouldRefit: boolean): void;
}

/**
 * @throws when the browser cannot give a WebGL context; the shell shows a message instead.
 */
export function createPoincareScene(host: HTMLElement): PoincareScene {
	const stage = createThreeStage(host, {
		background: POINCARE_TOKENS.stage,
		cameraDirections: {
			[POINCARE_CAMERAS.ANGLED]: new Vector3(0.62, 0.42, 0.62),
			[POINCARE_CAMERAS.SIDE]: new Vector3(0, 0.05, 1)
		}
	});
	const sphere = stage.share(new SphereGeometry(SPHERE_RADIUS_UNITS, 24, 16));

	function setLayout(layout: PoincareLayout, roles: Map<string, TreeRole>, shouldRefit: boolean) {
		const world = stage.resetWorld();
		const points: Vector3[] = [];
		for (const p of layout.people) {
			const position = new Vector3(p.x, p.y, p.z);
			const mesh = new Mesh(sphere, new MeshStandardMaterial({ color: sexColour(p.person) }));
			mesh.position.copy(position);
			if (roles.get(p.id) === 'focus') mesh.scale.setScalar(FOCUS_SCALE);
			world.add(mesh);
			stage.track(p.id, position, p.person.isPrivate === true ? null : mesh);
			points.push(position);
		}
		const centre = new Vector3();
		for (const point of points) centre.add(point);
		if (points.length > 0) centre.divideScalar(points.length);
		stage.frame(points, centre, shouldRefit);
	}

	return { ...stage.handle, setLayout };
}
