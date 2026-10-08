<script lang="ts">
	import type { OrreryLayout } from '#lib/tree-layout/orrery.js';
	import { ORRERY_CAMERAS, type OrreryScene } from './orrery-scene.js';
	import { ORRERY_TOKENS } from './tree-tokens.js';
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
		{ kind: 'dot', colour: ORRERY_TOKENS.male, label: 'Male' },
		{ kind: 'dot', colour: ORRERY_TOKENS.female, label: 'Female' },
		{ kind: 'dot', colour: ORRERY_TOKENS.unknownSex, label: 'Other or unknown' },
		{ kind: 'halo', colour: ORRERY_TOKENS.legendHalo, label: 'Focus' }
	] as const;

	let scene = $state<OrreryScene | null>(null);
	let shouldReduceMotion = $state(false);
	// The shell reads the media query; the scene decides what to stop (drift and the tether pulse).
	$effect(() => scene?.setReducedMotion(shouldReduceMotion));

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
	bind:scene
	bind:shouldReduceMotion
	cameras={CAMERAS}
	legend={[...LEGEND]}
	{selectedPersonId}
	{onSelectPerson}
	{onOpenPerson}
	{onClearSelection}
	createScene={async (host) => (await import('./orrery-scene.js')).createOrreryScene(host)}
	applyLayout={(scene: OrreryScene, shouldRefit) => scene.setLayout(layout, roles, shouldRefit)}
/>
