<script lang="ts">
	import { goto } from '$app/navigation';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import Pager from '#lib/components/lists/Pager.svelte';
	import PlaceRewriteDialog from '#lib/components/modals/PlaceRewriteDialog.svelte';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import { undoApi } from '#lib/api/relationships.js';
	import { hasMinimumRole } from '#lib/shared/roles.js';
	import type { ChangeSummary } from '#lib/types/genealogy.js';
	import type { PageProps } from './$types';
	import { treePath } from '#lib/shared/tree-slug.js';

	let { data }: PageProps = $props();
	const { toasts } = getTreeContext();

	const base = $derived(treePath(data.summary.tree));
	const place = $derived(data.place);
	const entityHref = (kind: 'person' | 'partnership', id: string) =>
		`${base}/${kind === 'person' ? 'people' : 'unions'}/${encodeURIComponent(id)}`;
	const placeHref = (name: string) => `${base}/place?name=${encodeURIComponent(name)}`;
	const role = $derived(data.trees.find((t) => t.id === data.summary.tree.id)?.role);
	const canEdit = $derived(role !== undefined && hasMinimumRole(role, 'editor'));
	let isRewriting = $state(false);

	// The address of a place is its text, so a rename moves to the new address; Undo moves back. The
	// shared editor's undo reloads the current address, which after a rename names no place.
	async function rewritten(change: ChangeSummary | null, name: string) {
		const oldName = place.name;
		isRewriting = false;
		await goto(placeHref(name), { refreshAll: true });
		toasts.push(change?.summary ?? 'Place changed', {
			action: change?.isUndoable
				? {
						label: 'Undo',
						run: async () => {
							try {
								const { undone } = await undoApi(data.summary.tree.id);
								await goto(placeHref(oldName), { refreshAll: true });
								toasts.push(`Undid: ${undone.summary}`);
							} catch (cause: unknown) {
								toasts.push(messageOf(cause, 'Could not undo'), {
									tone: 'error',
									durationMs: 10_000
								});
							}
						}
					}
				: undefined
		});
	}
	const pageHref = (offset: number) =>
		`${base}/place?name=${encodeURIComponent(place.name)}${offset > 0 ? `&offset=${offset}` : ''}`;
</script>

<svelte:head>
	<title>{place.name} · Places · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<nav aria-label="Breadcrumb" class="text-sm text-stone-600">
	<a href="{base}/places" class="text-link">Places</a>
</nav>
<div class="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
	<h2 class="text-2xl font-bold text-stone-900" data-testid="place-name">{place.name}</h2>
	{#if canEdit}
		<button
			type="button"
			class="text-link text-sm"
			data-testid="rename-place"
			onclick={() => (isRewriting = true)}>Rename or merge</button
		>
	{/if}
</div>

<ul
	class="mt-4 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white"
	data-testid="place-facts"
>
	{#each place.facts as fact (fact.id)}
		<li class="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm">
			<span>
				<span class="font-semibold text-stone-900">{fact.label}</span>
				<span class="text-stone-600"> of </span>
				<a
					href={entityHref(fact.kind, fact.entityId)}
					class="font-semibold text-emerald-900 hover:underline">{fact.entityName}</a
				>
			</span>
			<span class="text-stone-600">{fact.dateText ?? 'Date unknown'}</span>
		</li>
	{/each}
</ul>
<Pager
	summary="Showing {place.offset + 1} to {place.offset + place.facts.length}"
	previousHref={place.offset > 0 ? pageHref(Math.max(0, place.offset - place.limit)) : null}
	nextHref={place.hasMore ? pageHref(place.offset + place.limit) : null}
/>

{#if canEdit}
	<PlaceRewriteDialog
		isOpen={isRewriting}
		treeId={data.summary.tree.id}
		placeId={place.id}
		currentName={place.name}
		onsaved={rewritten}
		oncancel={() => (isRewriting = false)}
	/>
{/if}
