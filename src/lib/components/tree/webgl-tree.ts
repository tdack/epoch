/**
 * What the WebGL tree views share between their DOM shell (`WebGlTreeShell.svelte`) and their
 * three.js scenes: the roles that decide who is named and lit, and the small handle the shell
 * drives. Plain TypeScript with no three.js import, so the shell stays out of the three.js bundle.
 */

import { ringLineage, type LineageSource } from '#lib/tree-layout/rings.js';
import { sexLabel } from '#lib/shared/sex.js';
import type { RelationshipGraphPerson } from '#lib/tree-layout/types.js';

/** One line of the legend: a sex dot, the focus halo, or a sample of a line. */
export interface LegendEntry {
	kind: 'dot' | 'halo' | 'line';
	colour: string;
	label: string;
}

/** The legend's sex dots, which every view shows, in the view's own shades. */
export function sexLegend(tokens: {
	male: string;
	female: string;
	unknownSex: string;
}): LegendEntry[] {
	return [
		{ kind: 'dot', colour: tokens.male, label: 'Male' },
		{ kind: 'dot', colour: tokens.female, label: 'Female' },
		{ kind: 'dot', colour: tokens.unknownSex, label: 'Other or unknown' }
	];
}

/**
 * What the page passes every WebGL view's canvas. A canvas keeps `layout` and hands the rest
 * straight to `WebGlTreeShell`, so the page can switch views without knowing which it draws.
 */
export interface WebGlCanvasProps<TLayout> {
	/** People and lines from the view's pure layout module. */
	layout: TLayout;
	/** Changes when the view should be re-framed; see `TreeCanvas`. */
	fitKey: string;
	/** Person whose details are open in the drawer, if any. */
	selectedPersonId?: string | null;
	/** A sphere or name was clicked or activated with Enter: refocus the view on them. */
	onSelectPerson?: (id: string) => void;
	/** Double-click or Shift+Enter on a person: open their details. */
	onOpenPerson?: (id: string) => void;
	/** Escape: drop the selection. */
	onClearSelection?: () => void;
}

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

const ROLE_LABELS: Record<TreeRole, string> = {
	focus: 'Focus person',
	ancestor: 'Ancestor',
	descendant: 'Descendant',
	partner: 'Partner'
};

/** What the hover card says about a person. Counts are of who is in view, not the whole tree. */
export interface HoverCard {
	name: string;
	sex: string;
	/** Where they stand on the focus line; null for everyone off it. */
	roleLabel: string | null;
	partnershipCount: number;
	childrenInView: number;
}

/**
 * The hover card for one person. Only recorded facts: the Ball's estimated eras place people but
 * are never shown, and private people get no card (they cannot be picked).
 */
export function hoverCard(
	person: RelationshipGraphPerson,
	people: readonly ShellPerson[],
	role: TreeRole | null
): HoverCard {
	let childrenInView = 0;
	for (const other of people)
		if (
			Object.values(other.person.parentsByUnion).some((parents) =>
				parents.some((parent) => parent.parentId === person.id)
			)
		)
			childrenInView++;
	return {
		name: person.displayName,
		sex: sexLabel(person.sex),
		roleLabel: role ? ROLE_LABELS[role] : null,
		partnershipCount: person.unionIds.length,
		childrenInView
	};
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
