<script lang="ts">
	import { Trash2 } from 'lucide-svelte';
	import PersonLink from '#lib/components/PersonLink.svelte';
	import type { RelativeAction, TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import type { ParentChildType } from '#lib/shared/relationship-model.js';
	import type { PersonPageDto, PersonSummaryDto } from '#lib/shared/person-page.js';
	import type { RelationshipKind } from '#lib/types/genealogy.js';
	import { LINK_TARGET, type RelativeTarget } from './relative-target.js';
	import { personPath, unionPath } from './person-paths.js';

	interface Props {
		dto: PersonPageDto;
		treeId: string;
		/** Every relative action (add, remove, edit or merge a partnership) goes through the editor's dialogs. */
		editor: TreeEditor;
		relativeTarget?: RelativeTarget;
	}

	let { dto, treeId, editor, relativeTarget = LINK_TARGET }: Props = $props();

	const subheading = 'text-[11px] font-semibold tracking-wide text-stone-500 uppercase';

	/** What the trash button on a relative's row hands to the editor. */
	function removal(
		relation: RelativeAction['relation'],
		relative: PersonSummaryDto,
		extra: { unionId?: string; type?: ParentChildType } = {}
	): RelativeAction {
		return {
			relation,
			owner: { id: dto.person.id, givenName: dto.person.displayName, surname: null },
			relative: {
				id: relative.id,
				givenName: relative.displayName,
				surname: null,
				isDeceased: relative.isDeceased
			},
			unionId: extra.unionId ?? null,
			type: extra.type ?? null
		};
	}

	const hasParents = $derived(dto.parentFamilies.length > 0);
	const hasSiblings = $derived(dto.siblings.full.length > 0 || dto.siblings.half.length > 0);

	function add(kind: RelationshipKind, unionId?: string) {
		editor.openRelationship(editor.anchorFor(dto.person.id), { kind, unionId });
	}
</script>

{#snippet relative(person: PersonSummaryDto, note: string, remove?: RelativeAction)}
	<li class="flex items-center justify-between gap-2">
		<span class="min-w-0 text-sm">
			<PersonLink {person} href={personPath(treeId, person.id)} {relativeTarget} />
			{#if note}<span class="text-xs text-stone-500">({note})</span>{/if}
		</span>
		{#if remove}
			<button
				type="button"
				onclick={() => editor.requestRelativeAction(remove)}
				title="Remove, or record what happened"
				aria-label={`Remove ${person.displayName}, or record what happened`}
				class="shrink-0 cursor-pointer rounded-lg border border-stone-200 bg-white px-2 py-1 text-stone-400 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700"
			>
				<Trash2 class="h-3.5 w-3.5" />
			</button>
		{/if}
	</li>
{/snippet}

{#snippet addLink(label: string, kind: RelationshipKind, unionId?: string)}
	<button
		type="button"
		onclick={() => add(kind, unionId)}
		class="cursor-pointer text-left text-[11px] font-semibold text-emerald-800 hover:text-emerald-950 hover:underline"
	>
		+ {label}
	</button>
{/snippet}

<div class="space-y-2">
	<h4 class={subheading}>Parents</h4>
	{#each dto.parentFamilies as family (family.unionId ?? 'direct')}
		<div class="space-y-1" data-testid="parents">
			<ul class="space-y-1">
				{#each family.parents as parent (parent.person.id + parent.type)}
					{@render relative(
						parent.person,
						parent.type === 'biological' ? '' : parent.type,
						removal('parent', parent.person, { type: parent.type })
					)}
				{/each}
			</ul>
			{#if family.unionId}<p class="text-xs">
					<a class="row-link" href={unionPath(treeId, family.unionId)}
						>{family.label?.full ?? 'Their partnership'}</a
					>
				</p>{/if}
			{@render addLink('Add parent', 'add_parent', family.unionId ?? undefined)}
		</div>
	{:else}
		<div class="space-y-1" data-testid="parents">
			<p class="text-xs text-stone-500 italic">None recorded.</p>
			{@render addLink('Add parent', 'add_parent')}
		</div>
	{/each}
</div>

<div class="space-y-2">
	<h4 class={subheading}>Partnerships and children</h4>
	{#if dto.partnerships.length === 0 && dto.directChildren.length === 0}<p
			class="text-xs text-stone-500 italic"
		>
			None recorded.
		</p>{/if}
	{#each dto.partnerships as union (union.unionId)}
		<div
			class="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5"
			data-testid="partnership"
		>
			<div class="flex flex-wrap items-baseline justify-between gap-x-2">
				<p class="text-xs font-semibold text-amber-900">
					<a class="row-link" href={unionPath(treeId, union.unionId)}
						>{union.label?.full ??
							(union.partners.length > 0
								? 'Partner & Children'
								: 'Children, other parent not recorded')}</a
					>
					{#if union.status !== 'active'}<span class="text-red-700"> · {union.status}</span>{/if}
					{#if union.isWidowed}<span class="text-stone-700"> · widowed</span>{/if}
				</p>
				<span class="flex items-center gap-2 text-[11px]">
					<button
						type="button"
						onclick={() => editor.editUnion(union.unionId)}
						class="text-link cursor-pointer">Dates &amp; status</button
					>
					{#if union.isMergeable}
						<button
							type="button"
							onclick={() => editor.mergeUnion(union.unionId)}
							class="text-link cursor-pointer">Merge…</button
						>
					{/if}
				</span>
			</div>
			<ul class="space-y-1">
				{#each union.partners as partner (partner.id)}
					{@render relative(
						partner,
						partner.isDeceased ? 'deceased' : 'partner',
						removal('partner', partner, { unionId: union.unionId })
					)}
				{/each}
			</ul>
			{#if union.partners.length === 0}{@render addLink(
					'Add partner',
					'add_partner',
					union.unionId
				)}{/if}
			{#if union.children.length > 0}
				<p class="pt-0.5 text-[10px] font-semibold tracking-wide text-stone-500 uppercase">
					Children
				</p>
				<ul class="space-y-1">
					{#each union.children as child (child.person.id)}
						{@render relative(
							child.person,
							'',
							removal('child', child.person, { type: child.types[0] })
						)}
					{/each}
				</ul>
			{/if}
			{@render addLink('Add child', 'add_child', union.unionId)}
		</div>
	{/each}
	{#if dto.directChildren.length > 0}
		<p class="text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
			Children (no partnership recorded)
		</p>
		<ul class="space-y-1">
			{#each dto.directChildren as child (child.person.id)}
				{@render relative(
					child.person,
					'',
					removal('child', child.person, { type: child.types[0] })
				)}
			{/each}
		</ul>
	{/if}
</div>

{#if hasParents || hasSiblings}
	<div class="space-y-2" data-testid="siblings">
		<h4 class={subheading}>Siblings</h4>
		{#if !hasSiblings}<p class="text-xs text-stone-500 italic">None recorded.</p>{/if}
		<ul class="space-y-1">
			{#each dto.siblings.full as sibling (sibling.id)}
				{@render relative(sibling, '', removal('sibling', sibling))}
			{/each}
			{#each dto.siblings.half as sibling (sibling.id)}
				{@render relative(sibling, 'half-sibling', removal('sibling', sibling))}
			{/each}
		</ul>
		{@render addLink('Add sibling', 'add_sibling')}
	</div>
{/if}

{#if dto.stepParents.length > 0 || dto.stepChildren.length > 0}
	<div class="space-y-2" data-testid="step-relatives">
		<h4 class={subheading}>Step relatives</h4>
		<ul class="space-y-1">
			{#each dto.stepParents as step (step.person.id)}
				{@render relative(step.person, 'step-parent')}
			{/each}
			{#each dto.stepChildren as step (step.person.id)}
				{@render relative(step.person, `step-child, via ${step.via.displayName}`)}
			{/each}
		</ul>
	</div>
{/if}

<button
	type="button"
	onclick={() => editor.openRelationship(editor.anchorFor(dto.person.id))}
	class="w-full cursor-pointer rounded-lg border border-stone-200 bg-stone-100/70 px-2 py-1.5 text-left text-xs font-medium text-emerald-800 transition-colors hover:bg-white hover:text-emerald-950"
>
	+ Add a parent, partner, child or sibling
</button>
