<script lang="ts">
	import PersonView from '#lib/components/person/PersonView.svelte';
	import { treePath } from '#lib/components/person/person-paths.js';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import { recordRecentApi } from '#lib/api/lists.js';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	const { editor, toasts, marks, isPublicVisitor } = getTreeContext();

	const dto = $derived(data.person);
	const treeId = $derived(data.summary.tree.id);
	const treeHref = $derived(treePath(data.summary.tree));
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
		if (isPublicVisitor) return;
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

<PersonView
	{dto}
	{treeId}
	treeSlug={data.summary.tree.slug}
	{role}
	{editor}
	{toasts}
	{marks}
	layout="page"
/>
