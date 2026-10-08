<script lang="ts">
	import { ringLineage, type RingsLayout } from '#lib/tree-layout/rings.js';
	import { RING_CAMERAS, type RingsScene } from './rings-scene.js';
	import { RING_TOKENS } from './tree-tokens.js';
	import WebGlTreeShell from './WebGlTreeShell.svelte';
	import {
		lineageRoles,
		sexLegend,
		type LegendEntry,
		type WebGlCanvasProps
	} from './webgl-tree.js';

	let { layout, ...shellProps }: WebGlCanvasProps<RingsLayout> = $props();

	const CAMERAS = [
		{ id: RING_CAMERAS.ANGLED, label: 'Angled' },
		{ id: RING_CAMERAS.SIDE, label: 'Side' },
		{ id: RING_CAMERAS.ABOVE, label: 'Above' }
	];
	const LEGEND = [
		...sexLegend(RING_TOKENS),
		{ kind: 'halo', colour: RING_TOKENS.focus, label: 'Focus' },
		{ kind: 'line', colour: RING_TOKENS.ancestor, label: 'Ancestor line' },
		{ kind: 'line', colour: RING_TOKENS.descendant, label: 'Descendant line' },
		{ kind: 'line', colour: RING_TOKENS.partner, label: 'Partnership' }
	] satisfies LegendEntry[];

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
	cameras={CAMERAS}
	legend={LEGEND}
	{...shellProps}
	createScene={async (host) => (await import('./rings-scene.js')).createRingsScene(host)}
	applyLayout={(scene: RingsScene, shown, shouldRefit) =>
		scene.setLayout(layout, shown, shouldRefit)}
/>
