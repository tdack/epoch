<script lang="ts">
	import { GitMerge, Pencil, TriangleAlert, Info, Trash2, UserPlus } from 'lucide-svelte';
	import PersonLink from '#lib/components/PersonLink.svelte';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import { UNION_STATUS_LABELS } from '#lib/shared/union-events.js';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	const { editor } = getTreeContext();

	const dto = $derived(data.union);
	const treeId = $derived(data.summary.tree.id);
	const treeHref = $derived(`/trees/${encodeURIComponent(treeId)}`);
	const personHref = (id: string) => `${treeHref}/people/${encodeURIComponent(id)}`;
	/** A placeholder has no page for this viewer, so the chronology names them without a link. */
	const privateIds = $derived(
		new Set(
			[...dto.partners, ...dto.children.map((c) => c.person)]
				.filter((p) => p.isPrivate)
				.map((p) => p.id)
		)
	);
	const unionHref = (id: string) => `${treeHref}/unions/${encodeURIComponent(id)}`;
	const title = $derived(dto.partners.map((p) => p.displayName).join(' and ') || 'Partnership');

	$effect(() => {
		editor.graph = dto.graph;
		return () => (editor.graph = null);
	});

	const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : 'unknown');
</script>

<svelte:head>
	<title>{title} · Epoch</title>
</svelte:head>

<nav aria-label="Breadcrumb" class="text-xs text-stone-600">
	<a href={treeHref} class="font-semibold text-emerald-800 hover:underline"
		>{data.summary.tree.name}</a
	>
	<span aria-hidden="true"> › </span>
	<span>Partnerships</span>
	<span aria-hidden="true"> › </span>
	<span aria-current="page">{title}</span>
</nav>

<header class="flex flex-wrap items-start justify-between gap-3">
	<div>
		<h2 class="text-2xl font-bold text-stone-900" data-testid="union-title">{title}</h2>
		<p class="mt-1 text-sm text-stone-600">
			<span data-testid="union-label">{dto.union.label?.full ?? 'Partnership'}</span> · {UNION_STATUS_LABELS[
				dto.union.status
			]}
		</p>
	</div>
	<div class="flex flex-wrap gap-2">
		<button type="button" onclick={() => editor.editUnion(dto.union.id)} class="btn"
			><Pencil class="h-3.5 w-3.5" />Edit</button
		>
		{#if dto.partners[0]}
			<button
				type="button"
				onclick={() =>
					editor.openRelationship(editor.anchorFor(dto.partners[0]!.id), {
						kind: 'add_child',
						unionId: dto.union.id
					})}
				class="btn"
			>
				<UserPlus class="h-3.5 w-3.5" />Add child
			</button>
		{/if}
		{#if dto.union.status === 'active'}
			<button type="button" onclick={() => editor.endUnion(dto.union.id)} class="btn">End…</button>
		{/if}
		{#if dto.twins.length > 0}
			<button type="button" onclick={() => editor.mergeUnion(dto.union.id)} class="btn"
				><GitMerge class="h-3.5 w-3.5" />Merge…</button
			>
		{/if}
		<button type="button" onclick={() => editor.removeUnion(dto.union.id)} class="btn text-red-700"
			><Trash2 class="h-3.5 w-3.5" />Delete…</button
		>
	</div>
</header>

{#if dto.warnings.length > 0}
	<section aria-labelledby="warnings-heading" class="card" data-testid="warnings">
		<h3 id="warnings-heading" class="heading">Warnings</h3>
		<ul class="mt-2 space-y-1.5 text-sm">
			{#each dto.warnings as warning (warning.code + warning.subjectIds.join())}
				<li
					class="flex items-start gap-2 {warning.severity === 'warning'
						? 'text-amber-900'
						: 'text-stone-700'}"
					data-warning={warning.code}
				>
					{#if warning.severity === 'warning'}<TriangleAlert
							class="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
							aria-label="Warning"
						/>{:else}<Info class="mt-0.5 h-4 w-4 shrink-0 text-stone-500" aria-label="Note" />{/if}
					<span>{warning.message}</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<div class="grid gap-6 lg:grid-cols-2">
	<div class="space-y-6">
		<section aria-labelledby="partners-heading" class="card">
			<h3 id="partners-heading" class="heading">Partners</h3>
			{#if dto.partners.length === 0}<p class="mt-2 text-xs text-stone-500 italic">
					No partners recorded.
				</p>{/if}
			<ul class="mt-2 space-y-1 text-sm" data-testid="partners">
				{#each dto.partners as partner (partner.id)}
					<li>
						<PersonLink person={partner} href={personHref(partner.id)} />
						<span class="text-xs text-stone-500"
							>{partner.birthDate ?? ''}{partner.isDeceased
								? ` – ${partner.deathDate ?? 'deceased'}`
								: ''}</span
						>
					</li>
				{/each}
			</ul>
		</section>

		<section aria-labelledby="events-heading" class="card">
			<h3 id="events-heading" class="heading">Relationship events</h3>
			{#if dto.events.length === 0}<p class="mt-2 text-xs text-stone-500 italic">
					None recorded. Use Edit to add a marriage, separation or divorce.
				</p>{/if}
			<ul class="mt-2 space-y-1.5 text-sm" data-testid="union-events">
				{#each dto.events as event (event.id)}
					<li>
						<span class="font-medium">{event.label}</span>
						<span class="text-xs text-stone-600"
							>{event.dateText ?? 'Date unknown'}{#if event.place}{' · '}<a
									href="/trees/{encodeURIComponent(
										data.summary.tree.id
									)}/place?name={encodeURIComponent(event.place)}"
									class="hover:underline">{event.place}</a
								>{/if}</span
						>
						{#if event.notes}<span class="block text-xs text-stone-500">{event.notes}</span>{/if}
					</li>
				{/each}
			</ul>
		</section>

		<section aria-labelledby="children-heading" class="card">
			<h3 id="children-heading" class="heading">Children</h3>
			{#if dto.children.length === 0}<p class="mt-2 text-xs text-stone-500 italic">
					No children recorded.
				</p>{/if}
			<ul class="mt-2 space-y-1.5 text-sm" data-testid="union-children">
				{#each dto.children as child (child.person.id)}
					<li>
						<PersonLink person={child.person} href={personHref(child.person.id)} />
						<span class="text-xs text-stone-500">{child.person.birthDate ?? ''}</span>
						<span class="block text-xs text-stone-500"
							>{child.links.map((l) => `${l.parentName}: ${l.type}`).join(' · ')}</span
						>
					</li>
				{/each}
			</ul>
		</section>
	</div>

	<div class="space-y-6">
		<section aria-labelledby="chronology-heading" class="card">
			<h3 id="chronology-heading" class="heading">Chronology</h3>
			{#if dto.chronology.length === 0}<p class="mt-2 text-xs text-stone-500 italic">
					Nothing dated yet.
				</p>{/if}
			<ol class="mt-2 space-y-1 text-sm" data-testid="chronology">
				{#each dto.chronology as entry, index (index)}
					<li class="flex gap-3">
						<span class="w-28 shrink-0 text-xs text-stone-500">{entry.dateText ?? 'undated'}</span>
						<span class={entry.kind === 'union_event' ? 'font-semibold text-emerald-900' : ''}>
							{#if entry.personId && !privateIds.has(entry.personId)}<a
									class="link"
									href={personHref(entry.personId)}>{entry.label}</a
								>{:else}{entry.label}{/if}
						</span>
					</li>
				{/each}
			</ol>
		</section>

		{#if dto.twins.length > 0}
			<section aria-labelledby="twins-heading" class="card">
				<h3 id="twins-heading" class="heading">Same partners</h3>
				<ul class="mt-2 space-y-1 text-sm">
					{#each dto.twins as twin (twin.unionId)}
						<li>
							<a class="link" href={unionHref(twin.unionId)}
								>{twin.label?.full ?? 'Another partnership'}</a
							>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section aria-labelledby="history-heading" class="card">
			<h3 id="history-heading" class="heading">History</h3>
			<p class="mt-1 text-xs text-stone-500">
				Created {when(dto.changes.createdAt)} · last written {when(dto.changes.updatedAt)}
			</p>
			{#if dto.union.xrefAliases.length > 0}<p class="mt-1 text-xs text-stone-500">
					Merged from {dto.union.xrefAliases.join(', ')}
				</p>{/if}
			{#if dto.changes.recent.length === 0}
				<p class="mt-2 text-xs text-stone-500 italic">
					No changes are logged for this partnership. Imported records have no history.
				</p>
			{:else}
				<ul class="mt-2 space-y-1.5 text-xs" data-testid="history">
					{#each dto.changes.recent as change (change.id)}
						<li>
							<span class="font-medium text-stone-800">{change.summary}</span>
							<span class="block text-stone-500"
								>{change.actorName ?? 'Someone'} · {when(change.createdAt)}</span
							>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
</div>

<style>
	.card {
		border-radius: 1rem;
		border: 1px solid var(--color-stone-200);
		background: var(--color-stone-50);
		padding: 1rem;
	}
	.heading {
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--color-stone-600);
	}
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		cursor: pointer;
		border-radius: 0.5rem;
		border: 1px solid var(--color-stone-300);
		background: var(--color-stone-100);
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-stone-800);
	}
	.btn:hover {
		background: var(--color-stone-200);
	}
	.link {
		cursor: pointer;
		font-weight: 500;
		color: var(--color-emerald-800);
	}
	.link:hover {
		text-decoration: underline;
	}
</style>
