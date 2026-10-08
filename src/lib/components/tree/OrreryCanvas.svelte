<script lang="ts">
	import type { OrreryLayout } from '#lib/tree-layout/orrery.js';
	import { ORRERY_CAMERAS, type OrreryScene } from './orrery-scene.js';
	import { RING_TOKENS } from './tree-tokens.js';
	import WebGlTreeShell from './WebGlTreeShell.svelte';
	import { lineageRoles } from './webgl-tree.js';

	interface Props {
		/** People and lines from `layoutOrrery`. */
		layout: OrreryLayout;
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

	let {
		layout,
		fitKey,
		selectedPersonId = null,
		onSelectPerson,
		onOpenPerson,
		onClearSelection
	}: Props = $props();

	const CAMERAS = [
		{ id: ORRERY_CAMERAS.ANGLED, label: 'Angled' },
		{ id: ORRERY_CAMERAS.SIDE, label: 'Side' }
	];
	const LEGEND = [
		{ kind: 'dot', colour: RING_TOKENS.male, label: 'Male' },
		{ kind: 'dot', colour: RING_TOKENS.female, label: 'Female' },
		{ kind: 'dot', colour: RING_TOKENS.unknownSex, label: 'Other or unknown' },
		{ kind: 'halo', colour: RING_TOKENS.focus, label: 'Focus' }
	] as const;

	const roles = $derived(lineageRoles(layout));
	const focus = $derived(layout.people.find((p) => p.id === layout.focusPersonId));
	const announcement = $derived(
		focus
			? `Orrery centred on ${focus.person.displayName}: ${layout.people.length} people shown.`
			: ''
	);
</script>

<WebGlTreeShell
	people={layout.people}
	{roles}
	label="Orrery view"
	viewName="Orrery"
	subject="the orrery"
	{announcement}
	{fitKey}
	cameras={CAMERAS}
	legend={[...LEGEND]}
	{selectedPersonId}
	{onSelectPerson}
	{onOpenPerson}
	{onClearSelection}
	createScene={async (host) => (await import('./orrery-scene.js')).createOrreryScene(host)}
	applyLayout={(scene: OrreryScene, shouldRefit) => scene.setLayout(layout, roles, shouldRefit)}
/>
