<script lang="ts">
	import { Ellipsis } from '@lucide/svelte';
	import CitationsDisclosure from '#lib/components/evidence/CitationsDisclosure.svelte';
	import { citationsOfSubject } from '#lib/components/evidence/evidence-select.js';
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import PersonLink from '#lib/components/PersonLink.svelte';
	import type { RelativeAction, TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import type { ParentChildType } from '#lib/shared/relationship-model.js';
	import type { AssociationDto, PersonPageDto, PersonSummaryDto } from '#lib/shared/person-page.js';
	import type { RelationshipKind } from '#lib/types/genealogy.js';
	import { CITATION_SUBJECT_KINDS } from '#lib/shared/evidence.js';
	import { canChangeRecords, canCreateRecords, type TreeRole } from '#lib/shared/roles.js';
	import { LINK_TARGET, type RelativeTarget } from './relative-target.js';
	import { personPath, unionPath } from './person-paths.js';

	interface Props {
		dto: PersonPageDto;
		treeId: string;
		/** The tree's slug, for the links this builds (ADR-045); without one they use the id. */
		treeSlug?: string | null;
		/** The viewer's role; a viewer sees the family without the controls that change it. */
		role: TreeRole | undefined;
		/** Every relative action (add, remove, edit or merge a partnership) goes through the editor's dialogs. */
		editor: TreeEditor;
		toasts: ToastStore;
		relativeTarget?: RelativeTarget;
	}

	let {
		dto,
		treeId,
		treeSlug = null,
		role,
		editor,
		toasts,
		relativeTarget = LINK_TARGET
	}: Props = $props();
	const treeRef = $derived({ id: treeId, slug: treeSlug });

	const canAdd = $derived(canCreateRecords(role));
	const canChange = $derived(canChangeRecords(role));

	const subheading = 'text-[11px] font-semibold tracking-wide text-stone-500 uppercase';

	/** What the options button on a relative's row hands to the editor. */
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

	/** Read as the linked person's part: "godfather at christening", or this person's part in theirs. */
	function associationNote(association: AssociationDto): string {
		const fact = association.factLabel?.toLowerCase();
		// Files often capitalise the word ("Godfather"); it sits mid-sentence here.
		const role = association.role?.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase()) ?? null;
		if (!association.isNamedBy)
			return fact ? `${role ?? 'associate'} at ${fact}` : (role ?? 'associate');
		if (fact) return role ? `this person was ${role} at their ${fact}` : `named at their ${fact}`;
		return role ? `this person was their ${role}` : 'names this person as an associate';
	}

	function add(kind: RelationshipKind, unionId?: string) {
		editor.openRelationship(editor.anchorFor(dto.person.id), { kind, unionId });
	}
</script>

{#snippet relative(
	person: PersonSummaryDto,
	note: string,
	remove?: RelativeAction,
	linkId?: string | null
)}
	<li>
		<div class="flex items-center justify-between gap-2">
			<span class="min-w-0 text-sm">
				<PersonLink {person} href={personPath(treeRef, person.id)} {relativeTarget} />
				{#if note}<span class="text-xs text-stone-500">({note})</span>{/if}
			</span>
			{#if remove && canChange}
				<!-- Opens a choice (record a death or separation, or remove the link), so it is not drawn as
			     a trash can: most of what it leads to deletes nothing. -->
				<button
					type="button"
					onclick={() => editor.requestRelativeAction(remove)}
					aria-label={`Options for ${person.displayName}: record what happened, or remove`}
					class="shrink-0 cursor-pointer rounded-lg border border-stone-200 bg-white px-2 py-1 text-stone-500 focus-ring transition-colors hover:bg-stone-100 hover:text-stone-800 coarse:min-h-11 coarse:min-w-11"
				>
					<Ellipsis class="h-3.5 w-3.5" aria-hidden="true" />
				</button>
			{/if}
		</div>
		{#if linkId}
			{@const citations = citationsOfSubject(
				dto.evidence.citations,
				CITATION_SUBJECT_KINDS.PARENT_CHILD,
				linkId
			)}
			<!-- The parent link is a claim like a fact: it carries its own evidence marker. -->
			<CitationsDisclosure
				{treeId}
				{treeSlug}
				{role}
				{editor}
				{toasts}
				subjectLabel={`${person.displayName} as parent`}
				subject={{ kind: CITATION_SUBJECT_KINDS.PARENT_CHILD, id: linkId }}
				{citations}
				citationCount={citations.length}
				label={`${person.displayName} as parent`}
			/>
		{/if}
	</li>
{/snippet}

{#snippet addLink(label: string, kind: RelationshipKind, unionId?: string)}
	{#if canAdd}<button
			type="button"
			onclick={() => add(kind, unionId)}
			class="cursor-pointer text-left text-[11px] font-semibold text-emerald-800 hover:text-emerald-950 hover:underline"
		>
			+ {label}
		</button>{/if}
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
						removal('parent', parent.person, { type: parent.type }),
						parent.linkId
					)}
				{/each}
			</ul>
			{#if family.unionId}<p class="text-xs">
					<a class="row-link" href={unionPath(treeRef, family.unionId)}
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
					<a class="row-link" href={unionPath(treeRef, union.unionId)}
						>{union.label?.full ??
							(union.partners.length > 0
								? 'Partner & Children'
								: 'Children, other parent not recorded')}</a
					>
					{#if union.status !== 'active'}<span class="text-red-700"> · {union.status}</span>{/if}
					{#if union.isWidowed}<span class="text-stone-700"> · widowed</span>{/if}
				</p>
				{#if canChange}<span class="flex items-center gap-2 text-[11px]">
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
					</span>{/if}
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

{#if dto.associations.length > 0}
	<!-- Imported and read-only: Epoch keeps the lines, it does not edit them yet. -->
	<div class="space-y-2" data-testid="associates">
		<h4 class={subheading}>Associates</h4>
		<ul class="space-y-1">
			{#each dto.associations as association, i (i)}
				{@render relative(association.person, associationNote(association))}
			{/each}
		</ul>
	</div>
{/if}

{#if canAdd}<button
		type="button"
		onclick={() => editor.openRelationship(editor.anchorFor(dto.person.id))}
		class="w-full cursor-pointer rounded-lg border border-stone-200 bg-stone-100/70 px-2 py-1.5 text-left text-xs font-medium text-emerald-800 transition-colors hover:bg-white hover:text-emerald-950"
	>
		+ Add a parent, partner, child or sibling
	</button>{/if}
