<script lang="ts">
	import { ringLineage, type RingsLayout } from '#lib/tree-layout/rings.js';
	import type { RingsScene } from './rings-scene.js';
	import { RING_CAMERAS } from './webgl-cameras.js';
	import { RING_TOKENS } from './tree-tokens.js';
	import WebGlTreeShell from './WebGlTreeShell.svelte';
	import { DEFAULT_PALETTE } from './palette.js';
	import { sexLegend, type LegendEntry, type WebGlCanvasProps } from './webgl-tree.js';

	let {
		layout,
		palette = DEFAULT_PALETTE,
		...shellProps
	}: WebGlCanvasProps<RingsLayout> = $props();

	const CAMERAS = [
		{ id: RING_CAMERAS.ANGLED, label: 'Angled' },
		{ id: RING_CAMERAS.SIDE, label: 'Side' },
		{ id: RING_CAMERAS.ABOVE, label: 'Above' }
	];
	const LEGEND = $derived<LegendEntry[]>([
		...sexLegend(palette),
		{ kind: 'halo', colour: RING_TOKENS.focus, label: 'Focus' },
		{ kind: 'line', colour: palette.focus.ancestor, label: 'Ancestor line' },
		{ kind: 'line', colour: palette.focus.descendant, label: 'Descendant line' },
		{ kind: 'line', colour: palette.focus.partner, label: 'Partnership' }
	]);

	const focus = $derived(layout.people.find((p) => p.id === layout.focusPersonId));
	const lineage = $derived(ringLineage(layout, layout.focusPersonId ?? ''));
	const announcement = $derived(
		focus
			? `Rings centred on ${focus.person.displayName}: ${lineage.ancestorIds.size} ancestors and ${lineage.descendantIds.size} descendants shown across ${layout.rings.length} generations.`
			: layout.focusPersonId === null && layout.people.length > 0
				? `Rings: the whole tree, ${layout.people.length} people shown.`
				: ''
	);
</script>

<WebGlTreeShell
	people={layout.people}
	kin={layout}
	focusPersonId={layout.focusPersonId}
	label="Generation rings"
	viewName="Rings"
	subject="the rings"
	{announcement}
	cameras={CAMERAS}
	legend={LEGEND}
	{...shellProps}
	{palette}
	createScene={async (host) => (await import('./rings-scene.js')).createRingsScene(host, palette)}
	applyLayout={(scene: RingsScene, highlight, shouldRefit) =>
		scene.setLayout(layout, highlight, shouldRefit)}
/>
