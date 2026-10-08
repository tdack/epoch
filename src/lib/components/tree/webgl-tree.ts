/**
 * What the WebGL tree views share between their DOM shell (`WebGlTreeShell.svelte`) and their
 * three.js scenes: the roles that decide who is named and lit, and the small handle the shell
 * drives. Plain TypeScript with no three.js import, so the shell stays out of the three.js bundle.
 */

import { ringLineage, type LineageSource } from '#lib/tree-layout/rings.js';
import type { RelationshipGraphPerson } from '#lib/tree-layout/types.js';

/** What a sphere or line stands for on the focus person's line; absent is everyone else. */
export type TreeRole = 'focus' | 'ancestor' | 'descendant' | 'partner';

/** A person as the shell needs them: a name button each, ranked by generation. */
export interface ShellPerson {
	id: string;
	generation: number;
	person: RelationshipGraphPerson;
}

/** The focus person's line: ancestors, descendants and partners, each with its role. */
export function lineageRoles(
	layout: LineageSource & { focusPersonId: string }
): Map<string, TreeRole> {
	const lineage = ringLineage(layout, layout.focusPersonId);
	const roles = new Map<string, TreeRole>();
	for (const id of lineage.partnerIds) roles.set(id, 'partner');
	for (const id of lineage.descendantIds) roles.set(id, 'descendant');
	for (const id of lineage.ancestorIds) roles.set(id, 'ancestor');
	roles.set(layout.focusPersonId, 'focus');
	return roles;
}

/** What `WebGlTreeShell` calls on a mode's scene. `ThreeStage.handle` implements all of it. */
export interface WebGlTreeScene {
	/** Switch to a camera preset by id and re-frame the content already laid out. */
	setCamera(presetId: string): void;
	setSpinning(isSpinning: boolean): void;
	/** The person under a viewport point, or null. Private people are never picked. */
	pick(clientX: number, clientY: number): string | null;
	/** Where a person lands in the canvas, in CSS pixels; null when behind the camera or off it. */
	project(personId: string): { x: number; y: number } | null;
	/** Called after each drawn frame, so the shell can move its DOM names with the scene. */
	onFrame(callback: () => void): void;
	/** Draw the next frame even if nothing moved, as after names were added. */
	requestFrame(): void;
	dispose(): void;
}
