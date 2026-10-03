<script lang="ts">
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import type { MarksStore } from '#lib/components/layout/marks-store.svelte.js';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import type { PersonPageDto } from '#lib/shared/person-page.js';
	import type { TreeRole } from '#lib/shared/roles.js';
	import PersonActions from './PersonActions.svelte';
	import PersonEvidence from './PersonEvidence.svelte';
	import PersonFacts from './PersonFacts.svelte';
	import PersonFamily from './PersonFamily.svelte';
	import PersonHistory from './PersonHistory.svelte';
	import PersonMedia from './PersonMedia.svelte';
	import PersonNames from './PersonNames.svelte';
	import PersonNotes from './PersonNotes.svelte';
	import PersonPrivacy from './PersonPrivacy.svelte';
	import PersonSection from './PersonSection.svelte';
	import PersonSummary from './PersonSummary.svelte';
	import { canSetPrivacy } from './person-permissions.js';
	import type { RelativeTarget } from './relative-target.js';
	import { LINK_TARGET } from './relative-target.js';

	interface Props {
		dto: PersonPageDto;
		treeId: string;
		/** The viewer's role in this tree; each section hides what it cannot do. */
		role: TreeRole | undefined;
		/**
		 * `page` is two columns on a wide screen; `drawer` is one column of folding sections. The
		 * drawer's sections are the same components, so the layout is the only difference.
		 */
		layout: 'drawer' | 'page';
		relativeTarget?: RelativeTarget;
		editor: TreeEditor;
		toasts: ToastStore;
		marks: MarksStore;
	}

	let {
		dto,
		treeId,
		role,
		layout,
		relativeTarget = LINK_TARGET,
		editor,
		toasts,
		marks
	}: Props = $props();

	const isPage = $derived(layout === 'page');
</script>

{#snippet family()}
	<PersonSection id="family" title="Family" {layout} isOpenByDefault>
		<PersonFamily {dto} {treeId} {editor} {relativeTarget} />
	</PersonSection>
{/snippet}

{#snippet facts()}
	<PersonSection id="facts" title="Facts" {layout} isOpenByDefault>
		<PersonFacts {dto} {treeId} {role} {editor} {toasts} />
	</PersonSection>
{/snippet}

{#snippet names()}
	<PersonSection id="names" title="Names" {layout}>
		<PersonNames {dto} {treeId} {role} {editor} {toasts} />
	</PersonSection>
{/snippet}

{#snippet media()}
	<PersonSection id="media" title="Photos and documents" {layout}>
		<PersonMedia {dto} {treeId} {editor} />
	</PersonSection>
{/snippet}

{#snippet notes()}
	<PersonSection id="notes" title="Notes" {layout}>
		<PersonNotes {dto} {treeId} {role} {editor} {toasts} />
	</PersonSection>
{/snippet}

{#snippet evidence()}
	<PersonSection id="evidence" title="Sources and evidence" {layout}>
		<PersonEvidence {dto} {treeId} {role} {editor} {toasts} />
	</PersonSection>
{/snippet}

{#snippet privacy()}
	{#if canSetPrivacy(role, dto)}
		<PersonSection id="privacy" title="Privacy" {layout} testId="privacy-panel">
			<PersonPrivacy {dto} {treeId} {editor} />
		</PersonSection>
	{/if}
{/snippet}

{#snippet history()}
	<PersonSection id="history" title="History" {layout}><PersonHistory {dto} /></PersonSection>
{/snippet}

<div class="space-y-6">
	<header class="flex flex-wrap items-start justify-between gap-3">
		<PersonSummary {dto} />
		<PersonActions {dto} {treeId} {role} {editor} {toasts} {marks} {relativeTarget} />
	</header>

	{#if isPage}
		<div class="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
			<div class="space-y-6">
				{@render names()}
				{@render facts()}
				{@render notes()}
				{@render evidence()}
				{@render media()}
			</div>
			<div class="space-y-6">
				{@render family()}
				{@render privacy()}
				{@render history()}
			</div>
		</div>
	{:else}
		<div class="space-y-3">
			{@render family()}
			{@render facts()}
			{@render names()}
			{@render media()}
			{@render privacy()}
			{@render notes()}
			{@render evidence()}
			{@render history()}
		</div>
	{/if}
</div>
