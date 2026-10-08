<script lang="ts">
	import type { RibbonsLayout } from '#lib/tree-layout/ribbons.js';
	import { RIBBONS_CAMERAS, type RibbonsScene } from './ribbons-scene.js';
	import { RIBBON_TOKENS, RING_TOKENS } from './tree-tokens.js';
	import WebGlTreeShell from './WebGlTreeShell.svelte';
	import {
		lineageRoles,
		sexLegend,
		type LegendEntry,
		type WebGlCanvasProps
	} from './webgl-tree.js';

	let { layout, ...shellProps }: WebGlCanvasProps<RibbonsLayout> = $props();

	const CAMERAS = [
		{ id: RIBBONS_CAMERAS.ANGLED, label: 'Angled' },
		{ id: RIBBONS_CAMERAS.SIDE, label: 'Side' },
		{ id: RIBBONS_CAMERAS.EDGE, label: 'Edge' }
	];
	const LEGEND = [
		...sexLegend(RING_TOKENS),
		{ kind: 'dot', colour: RIBBON_TOKENS.knot, label: 'Union' },
		{ kind: 'halo', colour: RIBBON_TOKENS.focus, label: 'Focus' }
	] satisfies LegendEntry[];

	const roles = $derived(lineageRoles(layout));
	const focus = $derived(layout.people.find((p) => p.id === layout.focusPersonId));
	const announcement = $derived(
		focus
			? `Ribbons centred on ${focus.person.displayName}: ${layout.people.length} people and ${layout.unions.length} unions shown.`
			: ''
	);
</script>

<WebGlTreeShell
	people={layout.people}
	{roles}
	label="Ribbons view"
	viewName="Ribbons"
	subject="the ribbons"
	{announcement}
	cameras={CAMERAS}
	legend={LEGEND}
	{...shellProps}
	createScene={async (host) => (await import('./ribbons-scene.js')).createRibbonsScene(host)}
	applyLayout={(scene: RibbonsScene, shown, shouldRefit) =>
		scene.setLayout(layout, shown, shouldRefit)}
/>
