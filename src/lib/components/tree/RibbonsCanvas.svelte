<script lang="ts">
	import type { RibbonsLayout } from '#lib/tree-layout/ribbons.js';
	import { RIBBONS_CAMERAS, type RibbonsScene } from './ribbons-scene.js';
	import { RIBBON_TOKENS, RING_TOKENS } from './tree-tokens.js';
	import WebGlTreeShell from './WebGlTreeShell.svelte';
	import { lineageRoles } from './webgl-tree.js';

	interface Props {
		/** People and lines from `layoutRibbons`. */
		layout: RibbonsLayout;
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
		{ id: RIBBONS_CAMERAS.ANGLED, label: 'Angled' },
		{ id: RIBBONS_CAMERAS.SIDE, label: 'Side' },
		{ id: RIBBONS_CAMERAS.EDGE, label: 'Edge' }
	];
	const LEGEND = [
		{ kind: 'dot', colour: RING_TOKENS.male, label: 'Male' },
		{ kind: 'dot', colour: RING_TOKENS.female, label: 'Female' },
		{ kind: 'dot', colour: RING_TOKENS.unknownSex, label: 'Other or unknown' },
		{ kind: 'dot', colour: RIBBON_TOKENS.knot, label: 'Union' },
		{ kind: 'halo', colour: RIBBON_TOKENS.focus, label: 'Focus' }
	] as const;

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
	{fitKey}
	cameras={CAMERAS}
	legend={[...LEGEND]}
	{selectedPersonId}
	{onSelectPerson}
	{onOpenPerson}
	{onClearSelection}
	createScene={async (host) => (await import('./ribbons-scene.js')).createRibbonsScene(host)}
	applyLayout={(scene: RibbonsScene, shouldRefit) => scene.setLayout(layout, roles, shouldRefit)}
/>
