<script lang="ts">
	import type { RibbonsLayout } from '#lib/tree-layout/ribbons.js';
	import type { RibbonsScene } from './ribbons-scene.js';
	import { RIBBONS_CAMERAS } from './webgl-cameras.js';
	import { RIBBON_TOKENS } from '#lib/shared/tree-tokens.js';
	import WebGlTreeShell from './WebGlTreeShell.svelte';
	import { DEFAULT_PALETTE } from '#lib/shared/palette.js';
	import { sexLegend, type LegendEntry, type WebGlCanvasProps } from './webgl-tree.js';

	let {
		layout,
		palette = DEFAULT_PALETTE,
		...shellProps
	}: WebGlCanvasProps<RibbonsLayout> = $props();

	const CAMERAS = [
		{ id: RIBBONS_CAMERAS.ANGLED, label: 'Angled' },
		{ id: RIBBONS_CAMERAS.SIDE, label: 'Side' },
		{ id: RIBBONS_CAMERAS.EDGE, label: 'Edge' }
	];
	const LEGEND = $derived<LegendEntry[]>([
		...sexLegend(palette),
		{ kind: 'dot', colour: RIBBON_TOKENS.knot, label: 'Union' },
		{ kind: 'halo', colour: RIBBON_TOKENS.focus, label: 'Focus' }
	]);

	const focus = $derived(layout.people.find((p) => p.id === layout.focusPersonId));
	const announcement = $derived(
		focus
			? `Ribbons centred on ${focus.person.displayName}: ${layout.people.length} people and ${layout.unions.length} unions shown.`
			: layout.focusPersonId === null && layout.people.length > 0
				? `Ribbons: the whole tree, ${layout.people.length} people shown.`
				: ''
	);
</script>

<WebGlTreeShell
	people={layout.people}
	kin={layout}
	focusPersonId={layout.focusPersonId}
	label="Ribbons view"
	viewName="Ribbons"
	subject="the ribbons"
	{announcement}
	cameras={CAMERAS}
	initialCamera={RIBBONS_CAMERAS.SIDE}
	legend={LEGEND}
	{...shellProps}
	{palette}
	createScene={async (host) =>
		(await import('./ribbons-scene.js')).createRibbonsScene(host, palette)}
	applyLayout={(scene: RibbonsScene, highlight, shouldRefit) =>
		scene.setLayout(layout, highlight, shouldRefit)}
/>
