<script lang="ts">
	import PersonActions from '#lib/components/person/PersonActions.svelte';
	import PersonEvidence from '#lib/components/person/PersonEvidence.svelte';
	import PersonFacts from '#lib/components/person/PersonFacts.svelte';
	import PersonFamily from '#lib/components/person/PersonFamily.svelte';
	import PersonHistory from '#lib/components/person/PersonHistory.svelte';
	import PersonMedia from '#lib/components/person/PersonMedia.svelte';
	import PersonNames from '#lib/components/person/PersonNames.svelte';
	import PersonNotes from '#lib/components/person/PersonNotes.svelte';
	import PersonPrivacy from '#lib/components/person/PersonPrivacy.svelte';
	import PersonSection from '#lib/components/person/PersonSection.svelte';
	import PersonSummary from '#lib/components/person/PersonSummary.svelte';
	import { canSetPrivacy } from '#lib/components/person/person-permissions.js';
	import { treePath } from '#lib/components/person/person-paths.js';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import { recordRecentApi } from '#lib/services/tree-api.js';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	const { editor, toasts, marks } = getTreeContext();

	const dto = $derived(data.person);
	const treeId = $derived(data.summary.tree.id);
	const treeHref = $derived(treePath(treeId));
	const role = $derived(data.trees.find((t) => t.id === treeId)?.role);

	// The dialogs read versions and names from the graph the screen shows.
	$effect(() => {
		editor.graph = dto.graph;
		return () => (editor.graph = null);
	});

	// An explicit POST from the page, not a load: links preload on hover, and a preload is not a visit.
	// Effects never run on the server, so a server render records nothing either.
	$effect(() => {
		const personId = dto.person.id;
		void recordRecentApi(treeId, personId)
			.then((updated) => marks.set(updated))
			.catch(() => {
				// Recents are a convenience; a failed record is not worth a message.
			});
	});
</script>

<svelte:head>
	<title>{dto.person.displayName} · Epoch</title>
</svelte:head>

<nav aria-label="Breadcrumb" class="text-xs text-stone-600">
	<a href={treeHref} class="text-link">{data.summary.tree.name}</a>
	<span aria-hidden="true"> › </span>
	<a href={`${treeHref}/people`} class="text-link">People</a>
	<span aria-hidden="true"> › </span>
	<span aria-current="page">{dto.person.displayName}</span>
</nav>

<header class="flex flex-wrap items-start justify-between gap-3">
	<PersonSummary {dto} />
	<PersonActions {dto} {treeId} {role} {editor} {toasts} {marks} />
</header>

{#if canSetPrivacy(role, dto)}
	<PersonSection id="privacy" title="Privacy" layout="page" testId="privacy-panel">
		<PersonPrivacy {dto} {treeId} {editor} />
	</PersonSection>
{/if}

<div class="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
	<div class="space-y-6">
		<PersonSection id="names" title="Names" layout="page">
			<PersonNames {dto} {treeId} {editor} {toasts} />
		</PersonSection>
		<PersonSection id="facts" title="Facts" layout="page">
			<PersonFacts {dto} {treeId} {editor} {toasts} />
		</PersonSection>
		<div class="grid gap-6 sm:grid-cols-2">
			<PersonSection id="notes" title="Notes" layout="page"><PersonNotes /></PersonSection>
			<PersonSection id="evidence" title="Sources and evidence" layout="page"
				><PersonEvidence /></PersonSection
			>
		</div>
		<PersonSection id="media" title="Media" layout="page"><PersonMedia {dto} /></PersonSection>
	</div>

	<div class="space-y-6">
		<PersonSection id="family" title="Family" layout="page">
			<PersonFamily {dto} {treeId} />
		</PersonSection>
		<PersonSection id="history" title="History" layout="page">
			<PersonHistory {dto} />
		</PersonSection>
	</div>
</div>
