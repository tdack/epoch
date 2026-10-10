<script lang="ts">
	import type { OrreryLayout } from '#lib/tree-layout/orrery.js';
	import type { OrreryScene } from './orrery-scene.js';
	import { ORRERY_CAMERAS } from './webgl-cameras.js';
	import { ORRERY_TOKENS } from './tree-tokens.js';
	import WebGlTreeShell from './WebGlTreeShell.svelte';
	import { sexLegend, type LegendEntry, type WebGlCanvasProps } from './webgl-tree.js';

	let { layout, ...shellProps }: WebGlCanvasProps<OrreryLayout> = $props();

	const CAMERAS = [
		{ id: ORRERY_CAMERAS.ANGLED, label: 'Angled' },
		{ id: ORRERY_CAMERAS.SIDE, label: 'Side' }
	];
	const LEGEND = [
		...sexLegend(ORRERY_TOKENS),
		{ kind: 'halo', colour: ORRERY_TOKENS.legendHalo, label: 'Focus' }
	] satisfies LegendEntry[];

	/** Remembers a viewer's choice to hold the orrery still; per browser, not per tree. */
	const MOTION_STORAGE_KEY = 'epoch.orrery.isMoving';

	let scene = $state<OrreryScene | null>(null);
	let shouldReduceMotion = $state(false);
	let isMoving = $state(readIsMoving());
	// The shell reads the media query; the scene decides what to stop (drift and the tether pulse).
	$effect(() => scene?.setReducedMotion(shouldReduceMotion || !isMoving));

	function readIsMoving(): boolean {
		try {
			return localStorage.getItem(MOTION_STORAGE_KEY) !== 'false';
		} catch {
			return true;
		}
	}
	function toggleMotion() {
		isMoving = !isMoving;
		try {
			localStorage.setItem(MOTION_STORAGE_KEY, String(isMoving));
		} catch {
			// Private windows can refuse storage; the switch still works for this visit.
		}
	}

	const focus = $derived(layout.people.find((p) => p.id === layout.focusPersonId));
	const announcement = $derived(
		focus
			? `Orrery centred on ${focus.person.displayName}: ${layout.people.length} people shown.`
			: layout.focusPersonId === null && layout.people.length > 0
				? `Orrery: the whole tree, ${layout.people.length} people shown.`
				: ''
	);
</script>

{#snippet controls()}
	{#if !shouldReduceMotion}
		<button type="button" class="view" aria-pressed={isMoving} onclick={toggleMotion}>
			Motion
		</button>
	{/if}
{/snippet}

<WebGlTreeShell
	people={layout.people}
	kin={layout}
	focusPersonId={layout.focusPersonId}
	label="Orrery view"
	viewName="Orrery"
	subject="the orrery"
	{announcement}
	bind:scene
	bind:shouldReduceMotion
	{controls}
	cameras={CAMERAS}
	legend={LEGEND}
	{...shellProps}
	createScene={async (host) => (await import('./orrery-scene.js')).createOrreryScene(host)}
	applyLayout={(scene: OrreryScene, highlight, shouldRefit) =>
		scene.setLayout(layout, highlight, shouldRefit)}
/>
