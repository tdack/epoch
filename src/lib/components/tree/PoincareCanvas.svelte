<script lang="ts">
	import type { PoincareLayout } from '#lib/tree-layout/poincare.js';
	import { POINCARE_CAMERAS, type PoincareScene } from './poincare-scene.js';
	import { RING_TOKENS } from './tree-tokens.js';
	import WebGlTreeShell from './WebGlTreeShell.svelte';
	import { lineageRoles } from './webgl-tree.js';

	interface Props {
		/** People and lines from `layoutPoincare`. */
		layout: PoincareLayout;
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
		{ id: POINCARE_CAMERAS.ANGLED, label: 'Angled' },
		{ id: POINCARE_CAMERAS.SIDE, label: 'Side' }
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
			? `Ball centred on ${focus.person.displayName}: ${layout.people.length} people shown.`
			: ''
	);
</script>

<WebGlTreeShell
	people={layout.people}
	{roles}
	label="Ball view"
	viewName="Ball"
	subject="the ball"
	{announcement}
	{fitKey}
	cameras={CAMERAS}
	legend={[...LEGEND]}
	{selectedPersonId}
	{onSelectPerson}
	{onOpenPerson}
	{onClearSelection}
	createScene={async (host) => (await import('./poincare-scene.js')).createPoincareScene(host)}
	applyLayout={(scene: PoincareScene, shouldRefit) => scene.setLayout(layout, roles, shouldRefit)}
/>
