<script lang="ts">
	import CitationsDisclosure from '#lib/components/evidence/CitationsDisclosure.svelte';
	import { citationsOfSubject } from '#lib/components/evidence/evidence-select.js';
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import type { MarksStore } from '#lib/components/layout/marks-store.svelte.js';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import { CITATION_SUBJECT_KINDS } from '#lib/shared/evidence.js';
	import { FACT_KINDS } from '#lib/shared/fact-types.js';
	import type { PersonPageDto } from '#lib/shared/person-page.js';
	import type { TreeRole } from '#lib/shared/roles.js';
	import PersonActions from './PersonActions.svelte';
	import PersonFacts from './PersonFacts.svelte';
	import PersonFamily from './PersonFamily.svelte';
	import PersonHistory from './PersonHistory.svelte';
	import PersonMedia from './PersonMedia.svelte';
	import PersonNames from './PersonNames.svelte';
	import PersonNotes from './PersonNotes.svelte';
	import PersonPrivacy from './PersonPrivacy.svelte';
	import PersonSection from './PersonSection.svelte';
	import PersonSummary from './PersonSummary.svelte';
	import PersonTasks from './PersonTasks.svelte';
	import { canSetPrivacy } from './person-permissions.js';
	import type { RelativeTarget } from './relative-target.js';
	import { LINK_TARGET } from './relative-target.js';

	interface Props {
		dto: PersonPageDto;
		treeId: string;
		/** The tree's slug, for the links this builds (ADR-045); without one they use the id. */
		treeSlug?: string | null;
		/** The viewer's role in this tree; each section hides what it cannot do. */
		role: TreeRole | undefined;
		/**
		 * `drawer` is one column of folding sections, facts grouped by kind. `page` opens on the
		 * newest of each kind of attribute, then the person's life as a timeline and their family,
		 * and gathers the rest of the record into one quiet column (ADR-058, ADR-059). The sections
		 * are the same components either way.
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
		treeSlug = null,
		role,
		layout,
		relativeTarget = LINK_TARGET,
		editor,
		toasts,
		marks
	}: Props = $props();

	const isPage = $derived(layout === 'page');
	/** On the page the record's details share one card, so each section drops its own. */
	const isFlush = $derived(isPage);
	/** The person's own citations, shown once beneath the summary; a fact's or name's are on that row. */
	const hasAttributes = $derived(dto.facts.some((fact) => fact.kind === FACT_KINDS.ATTRIBUTE));
	const personCitations = $derived(
		citationsOfSubject(dto.evidence.citations, CITATION_SUBJECT_KINDS.PERSON, dto.person.id)
	);
</script>

{#snippet glance()}
	{#if hasAttributes}
		<PersonSection id="glance" title="At a glance" {layout}>
			<PersonFacts {dto} {treeId} {treeSlug} {role} {editor} {toasts} mode="attributes" />
		</PersonSection>
	{/if}
{/snippet}

{#snippet life()}
	<PersonSection id="life" title="Life" {layout} isOpenByDefault>
		<PersonFacts {dto} {treeId} {treeSlug} {role} {editor} {toasts} mode="timeline" />
	</PersonSection>
{/snippet}

{#snippet family()}
	<PersonSection id="family" title="Family" {layout} isOpenByDefault>
		<PersonFamily {dto} {treeId} {treeSlug} {role} {editor} {toasts} {relativeTarget} />
	</PersonSection>
{/snippet}

{#snippet facts()}
	<PersonSection id="facts" title="Facts" {layout} isOpenByDefault>
		<PersonFacts {dto} {treeId} {treeSlug} {role} {editor} {toasts} />
	</PersonSection>
{/snippet}

{#snippet names()}
	<PersonSection id="names" title="Names" {layout} {isFlush}>
		<PersonNames {dto} {treeId} {treeSlug} {role} {editor} {toasts} />
	</PersonSection>
{/snippet}

{#snippet media()}
	<PersonSection id="media" title="Photos and documents" {layout} {isFlush}>
		<PersonMedia {dto} {treeId} {editor} />
	</PersonSection>
{/snippet}

{#snippet notes()}
	<PersonSection id="notes" title="Notes" {layout} {isFlush}>
		<PersonNotes {dto} {treeId} {treeSlug} {role} {editor} {toasts} />
	</PersonSection>
{/snippet}

{#snippet tasks()}
	<PersonSection id="tasks" title="Tasks" {layout} {isFlush}>
		<PersonTasks {dto} {treeId} {treeSlug} {role} {editor} {toasts} />
	</PersonSection>
{/snippet}

{#snippet privacy()}
	{#if canSetPrivacy(role, dto)}
		<PersonSection id="privacy" title="Privacy" {layout} {isFlush} testId="privacy-panel">
			<PersonPrivacy {dto} {treeId} {editor} />
		</PersonSection>
	{/if}
{/snippet}

{#snippet history()}
	<PersonSection id="history" title="History" {layout} {isFlush}
		><PersonHistory {dto} tree={{ id: treeId, slug: treeSlug }} {editor} /></PersonSection
	>
{/snippet}

<div class="space-y-6">
	<header class="flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0 space-y-2">
			<PersonSummary {dto} isPageTitle={isPage} />
			<CitationsDisclosure
				{treeId}
				{treeSlug}
				{role}
				{editor}
				{toasts}
				subjectLabel={dto.person.displayName}
				subject={{ kind: CITATION_SUBJECT_KINDS.PERSON, id: dto.person.id }}
				citations={personCitations}
				citationCount={personCitations.length}
				label={dto.person.displayName}
			/>
		</div>
		<PersonActions {dto} {treeId} {treeSlug} {role} {editor} {toasts} {marks} {relativeTarget} />
	</header>

	{#if isPage}
		<div class="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
			<div class="space-y-6">
				{@render glance()}
				{@render life()}
				{@render family()}
			</div>
			<div class="section-card divide-y divide-stone-200 py-0" data-testid="record-details">
				{@render notes()}
				{@render names()}
				{@render media()}
				{@render tasks()}
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
			{@render tasks()}
			{@render history()}
		</div>
	{/if}
</div>
