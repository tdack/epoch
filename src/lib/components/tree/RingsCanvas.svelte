<script lang="ts">
	import { ringLineage, type RingsLayout } from '#lib/tree-layout/rings.js';
	import { RING_CAMERAS, type RingsScene } from './rings-scene.js';
	import { RING_TOKENS } from './tree-tokens.js';
	import WebGlTreeShell from './WebGlTreeShell.svelte';
	import { lineageRoles } from './webgl-tree.js';

	interface Props {
		/** Rings, people and lines from `layoutRings`. */
		layout: RingsLayout;
		/** Changes when the view should be re-framed; see `TreeCanvas`. */
		fitKey: string;
		/** Person whose details are open in the drawer, if any. */
		selectedPersonId?: string | null;
		/** A sphere or name was clicked or activated with Enter: refocus the rings on them. */
		onSelectPerson?: (id: string) => void;
		/** Double-click or Shift+Enter on a person: open their details. */
		onOpenPerson?: (id: string) => void;
		/** Escape: drop the selection. */
		onClearSelection?: () => void;
	}

	let {
		layout,
		fitKey,
		selectedPersonId = null,
		onSelectPerson,
		onOpenPerson,
		onClearSelection
	}: Props = $props();

	const CAMERAS = [
		{ id: RING_CAMERAS.ANGLED, label: 'Angled' },
		{ id: RING_CAMERAS.SIDE, label: 'Side' },
		{ id: RING_CAMERAS.ABOVE, label: 'Above' }
	];
	const LEGEND = [
		{ kind: 'dot', colour: RING_TOKENS.male, label: 'Male' },
		{ kind: 'dot', colour: RING_TOKENS.female, label: 'Female' },
		{ kind: 'dot', colour: RING_TOKENS.unknownSex, label: 'Other or unknown' },
		{ kind: 'halo', colour: RING_TOKENS.focus, label: 'Focus' },
		{ kind: 'line', colour: RING_TOKENS.ancestor, label: 'Ancestor line' },
		{ kind: 'line', colour: RING_TOKENS.descendant, label: 'Descendant line' },
		{ kind: 'line', colour: RING_TOKENS.partner, label: 'Partnership' }
	] as const;

	const roles = $derived(lineageRoles(layout));
	const focus = $derived(layout.people.find((p) => p.id === layout.focusPersonId));
	const lineage = $derived(ringLineage(layout, layout.focusPersonId));
	const announcement = $derived(
		focus
			? `Rings centred on ${focus.person.displayName}: ${lineage.ancestorIds.size} ancestors and ${lineage.descendantIds.size} descendants shown across ${layout.rings.length} generations.`
			: ''
	);
</script>

<WebGlTreeShell
	people={layout.people}
	{roles}
	label="Generation rings"
	viewName="Rings"
	subject="the rings"
	{announcement}
	{fitKey}
	cameras={CAMERAS}
	legend={[...LEGEND]}
	{selectedPersonId}
	{onSelectPerson}
	{onOpenPerson}
	{onClearSelection}
	createScene={async (host) => (await import('./rings-scene.js')).createRingsScene(host)}
	applyLayout={(scene: RingsScene, shouldRefit) => scene.setLayout(layout, roles, shouldRefit)}
/>
