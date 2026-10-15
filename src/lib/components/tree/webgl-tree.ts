/**
 * What the WebGL tree views share between their DOM shell (`WebGlTreeShell.svelte`) and their
 * three.js scenes: the roles a scene lights people by, the words for why something is lit, and the
 * small handle the shell drives. Plain TypeScript with no three.js import, so the shell stays out of the three.js bundle.
 */

import type { Palette } from './palette.js';
import { sexLabel } from '#lib/shared/sex.js';
import {
	linkKey,
	type Highlight,
	type HighlightSource,
	type KinSource,
	type Mark
} from '#lib/tree-layout/highlight.js';
import type { RelationshipGraphPerson } from '#lib/tree-layout/types.js';

/** Something a pointer can land on in the scene. A link's `id` is its `linkKey`. */
export interface PickTarget {
	kind: 'person' | 'union' | 'link';
	id: string;
}

export interface PickOptions {
	/** The pointer is a finger, so a line is picked from further away. */
	isCoarse?: boolean;
}

/** One line of the legend: a sex dot, the focus halo, or a sample of a line. */
export interface LegendEntry {
	kind: 'dot' | 'halo' | 'line';
	colour: string;
	label: string;
}

/**
 * The legend's sex dots, which every view shows, in the view's own shades: the sphere colour for
 * the 3D cards and spheres, the star colour for the Orrery.
 */
export function sexLegend(palette: Palette, shade: 'sphere' | 'star' = 'sphere'): LegendEntry[] {
	return [
		{ kind: 'dot', colour: palette.sex.male[shade], label: 'Male' },
		{ kind: 'dot', colour: palette.sex.female[shade], label: 'Female' },
		{ kind: 'dot', colour: palette.sex.unknown[shade], label: 'Other or unknown' }
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
	/** The colours to paint with, from the user's, the site's, or the built-in settings. */
	palette?: Palette;
	/** The viewer chose "Reduce animation" in their settings; adds to prefers-reduced-motion. */
	isMotionReduced?: boolean;
	/** Person whose details are open in the drawer, if any. */
	selectedPersonId?: string | null;
	/** The whole tree is drawn (`scope=all`): a person lights their line and the view does not refocus. */
	isWholeTree?: boolean;
	/** The Whole tree button: switch between the whole tree and the focus view. */
	onToggleWholeTree?: () => void;
	/** The whole tree stopped at its cap, so the picture is missing people the viewer may see. */
	isTruncated?: boolean;
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

/** What the hover card calls a role on the focus line, as it always has. */
const FOCUS_LABELS: Record<Mark['kind'], string> = {
	self: 'Focus person',
	ancestor: 'Ancestor',
	descendant: 'Descendant',
	partner: 'Partner'
};

/**
 * What a scene lights a person as, at the level the views have always lit: the focus, the line
 * above and below, and partners. The scenes read this until each view draws its own marks.
 */
export function highlightRoles(highlight: Highlight): Map<string, TreeRole> {
	const roles = new Map<string, TreeRole>();
	for (const [id, mark] of highlight.people) {
		const kinds: Record<Mark['kind'], TreeRole> = {
			// A person who is the source gets the focus mark; a partner in a selected partnership is
			// lit but is nobody's focus.
			self: highlight.sources[mark.sourceIndexes[0]]?.source.kind === 'union' ? 'partner' : 'focus',
			ancestor: 'ancestor',
			descendant: 'descendant',
			partner: 'partner'
		};
		roles.set(id, kinds[mark.kind]);
	}
	return roles;
}

/**
 * One sentence on why an item is lit, for the hover card and announcements. `label` names a
 * source: a person by name, a partnership by its partners, a line by its child.
 */
export function describeMark(
	mark: Mark,
	highlight: Highlight,
	label: (source: HighlightSource) => string
): string {
	if (mark.isShared)
		return mark.sourceIndexes.length > 1
			? `On ${mark.sourceIndexes.length} traced paths`
			: `Reached by more than one path from ${label(highlight.sources[mark.sourceIndexes[0]].source)}`;
	const source = highlight.sources[mark.sourceIndexes[0]]?.source;
	if (!source) return '';
	if (source.kind === 'focus') return FOCUS_LABELS[mark.kind];
	const suffix = highlight.isTrace ? ', traced' : '';
	switch (mark.kind) {
		case 'self':
			return highlight.isTrace ? 'Traced' : 'Selected';
		case 'ancestor':
			return `Ancestor of ${label(source)}${suffix}`;
		case 'descendant':
			return `Descendant of ${label(source)}${suffix}`;
		case 'partner':
			return `Partner of ${label(source)}${suffix}`;
	}
}

function joinNames(names: string[]): string {
	return names.length <= 2
		? names.join(' and ')
		: `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * What to call a source in a sentence ("Ancestor of …"): a person by name, a partnership by its
 * partners, a line by its child. Private people are never named; a partnership of only private
 * people is just "a partnership".
 */
export function sourceLabel(kin: KinSource, source: HighlightSource): string {
	const nameOf = (id: string) => {
		const person = kin.people.find((p) => p.id === id)?.person;
		return person && person.isPrivate !== true ? person.displayName : null;
	};
	const named = (ids: readonly string[]) =>
		ids.map(nameOf).filter((name): name is string => name !== null);
	switch (source.kind) {
		case 'focus':
		case 'person':
			return nameOf(source.personId) ?? 'a private person';
		case 'union': {
			const partners = named(kin.unions.find((u) => u.id === source.unionId)?.partnerIds ?? []);
			return partners.length > 0 ? `the partnership of ${joinNames(partners)}` : 'a partnership';
		}
		case 'link': {
			const link = kin.childLinks.find((l) => linkKey(l) === source.key);
			const child = link ? nameOf(link.childId) : null;
			return child ? `the line to ${child}` : 'a parent-child line';
		}
	}
}

/** What the hover card says about a person. Counts are of who is in view, not the whole tree. */
export interface HoverCard {
	name: string;
	sex: string;
	/** Why they are lit (see {@link describeMark}); null for everyone off the highlight. */
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
	markLabel: string | null
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
		roleLabel: markLabel,
		partnershipCount: person.unionIds.length,
		childrenInView
	};
}

/** What `WebGlTreeShell` calls on a mode's scene. `ThreeStage.handle` implements all of it. */
export interface WebGlTreeScene {
	/** Switch to a camera preset by id and re-frame the content already laid out. */
	setCamera(presetId: string): void;
	setSpinning(isSpinning: boolean): void;
	/**
	 * What is under a viewport point, or null: the nearest person or partnership marker, else a line. Private people are never picked. `isCoarse` widens the line's pick band for a finger.
	 */
	pick(clientX: number, clientY: number, options?: PickOptions): PickTarget | null;
	/** Where a tracked person, partnership or line lands in the canvas, in CSS pixels; null when behind the camera or off it. */
	project(target: PickTarget): { x: number; y: number } | null;
	/** Every pickable partnership and line the scene tracks, so tests can find what has no name. */
	targets(): PickTarget[];
	/** Called after each drawn frame, so the shell can move its DOM names with the scene. */
	onFrame(callback: () => void): void;
	/** Draw the next frame even if nothing moved, as after names were added. */
	requestFrame(): void;
	dispose(): void;
}
