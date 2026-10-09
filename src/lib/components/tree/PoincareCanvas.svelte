<script lang="ts">
	import type { PoincareLayout } from '#lib/tree-layout/poincare.js';
	import { POINCARE_CAMERAS, type PoincareScene } from './poincare-scene.js';
	import { RING_TOKENS } from './tree-tokens.js';
	import WebGlTreeShell from './WebGlTreeShell.svelte';
	import { sexLegend, type LegendEntry, type WebGlCanvasProps } from './webgl-tree.js';

	let { layout, ...shellProps }: WebGlCanvasProps<PoincareLayout> = $props();

	const CAMERAS = [
		{ id: POINCARE_CAMERAS.ANGLED, label: 'Angled' },
		{ id: POINCARE_CAMERAS.SIDE, label: 'Side' },
		{ id: POINCARE_CAMERAS.POLE, label: 'Pole' }
	];
	const LEGEND = [
		...sexLegend(RING_TOKENS),
		{ kind: 'halo', colour: RING_TOKENS.focus, label: 'Focus' }
	] satisfies LegendEntry[];

	const focus = $derived(layout.people.find((p) => p.id === layout.focusPersonId));
	const announcement = $derived(
		focus
			? `Ball centred on ${focus.person.displayName}: ${layout.people.length} people shown.${
					layout.hasDates ? '' : ' No dates were found, so height follows generations.'
				}`
			: layout.focusPersonId === null && layout.people.length > 0
				? `Ball: the whole tree, ${layout.people.length} people shown.`
				: ''
	);
</script>

{#snippet controls()}
	{#if !layout.hasDates && layout.people.length > 0}
		<span class="px-2 text-[var(--tree-ink-muted)]" data-testid="ball-no-dates">
			No dates found: height follows generations.
		</span>
	{/if}
{/snippet}

<WebGlTreeShell
	people={layout.people}
	kin={layout}
	focusPersonId={layout.focusPersonId}
	label="Ball view"
	viewName="Ball"
	subject="the ball"
	{announcement}
	cameras={CAMERAS}
	legend={LEGEND}
	{...shellProps}
	{controls}
	createScene={async (host) => (await import('./poincare-scene.js')).createPoincareScene(host)}
	applyLayout={(scene: PoincareScene, highlight, shouldRefit) =>
		scene.setLayout(layout, highlight, shouldRefit)}
/>
