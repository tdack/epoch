<script lang="ts">
	import type { OrreryLayout } from '#lib/tree-layout/orrery.js';
	import { ORRERY_CAMERAS, type OrreryScene } from './orrery-scene.js';
	import { ORRERY_TOKENS } from './tree-tokens.js';
	import WebGlTreeShell from './WebGlTreeShell.svelte';
	import {
		lineageRoles,
		sexLegend,
		type LegendEntry,
		type WebGlCanvasProps
	} from './webgl-tree.js';

	let { layout, ...shellProps }: WebGlCanvasProps<OrreryLayout> = $props();

	const CAMERAS = [
		{ id: ORRERY_CAMERAS.ANGLED, label: 'Angled' },
		{ id: ORRERY_CAMERAS.SIDE, label: 'Side' }
	];
	const LEGEND = [
		...sexLegend(ORRERY_TOKENS),
		{ kind: 'halo', colour: ORRERY_TOKENS.legendHalo, label: 'Focus' }
	] satisfies LegendEntry[];

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
	bind:scene
	bind:shouldReduceMotion
	cameras={CAMERAS}
	legend={LEGEND}
	{...shellProps}
	createScene={async (host) => (await import('./orrery-scene.js')).createOrreryScene(host)}
	applyLayout={(scene: OrreryScene, shouldRefit) => scene.setLayout(layout, roles, shouldRefit)}
/>
