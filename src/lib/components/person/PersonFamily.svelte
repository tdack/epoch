<script lang="ts">
	import PersonLink from '#lib/components/PersonLink.svelte';
	import type { PersonPageDto, PersonSummaryDto } from '#lib/shared/person-page.js';
	import { LINK_TARGET, type RelativeTarget } from './relative-target.js';
	import { personPath, unionPath } from './person-paths.js';

	interface Props {
		dto: PersonPageDto;
		treeId: string;
		relativeTarget?: RelativeTarget;
	}

	let { dto, treeId, relativeTarget = LINK_TARGET }: Props = $props();

	const childrenOf = (list: Array<{ person: PersonSummaryDto }>) => list.map((c) => c.person);
	const subheading = 'text-[11px] font-semibold tracking-wide text-stone-500 uppercase';
</script>

<div class="space-y-2">
	<h4 class={subheading}>Parents</h4>
	{#if dto.parentFamilies.length === 0}<p class="text-xs text-stone-500 italic">
			None recorded.
		</p>{/if}
	{#each dto.parentFamilies as family (family.unionId ?? 'direct')}
		<ul class="space-y-1 text-sm" data-testid="parents">
			{#each family.parents as parent (parent.person.id + parent.type)}
				<li>
					<PersonLink
						person={parent.person}
						href={personPath(treeId, parent.person.id)}
						{relativeTarget}
					/>
					<span class="text-xs text-stone-500"
						>{parent.type === 'biological' ? '' : parent.type}</span
					>
				</li>
			{/each}
			{#if family.unionId}<li class="text-xs">
					<a class="row-link" href={unionPath(treeId, family.unionId)}
						>{family.label?.full ?? 'Their partnership'}</a
					>
				</li>{/if}
		</ul>
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
		<div class="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5" data-testid="partnership">
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
			<ul class="mt-1 space-y-0.5 text-sm">
				{#each union.partners as partner (partner.id)}
					<li>
						<PersonLink
							person={partner}
							href={personPath(treeId, partner.id)}
							{relativeTarget}
						/>{#if partner.isDeceased}
							<span class="text-xs text-stone-500">(deceased)</span>{/if}
					</li>
				{/each}
			</ul>
			{#if union.children.length > 0}
				<p class="mt-2 text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
					Children
				</p>
				<ul class="space-y-0.5 text-sm">
					{#each childrenOf(union.children) as child (child.id)}
						<li>
							<PersonLink person={child} href={personPath(treeId, child.id)} {relativeTarget} />
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/each}
	{#if dto.directChildren.length > 0}
		<p class="text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
			Children (no partnership recorded)
		</p>
		<ul class="space-y-0.5 text-sm">
			{#each childrenOf(dto.directChildren) as child (child.id)}
				<li><PersonLink person={child} href={personPath(treeId, child.id)} {relativeTarget} /></li>
			{/each}
		</ul>
	{/if}
</div>

<div class="space-y-2">
	<h4 class={subheading}>Siblings</h4>
	{#if dto.siblings.full.length === 0 && dto.siblings.half.length === 0}<p
			class="text-xs text-stone-500 italic"
		>
			None recorded.
		</p>{/if}
	<ul class="space-y-0.5 text-sm" data-testid="siblings">
		{#each dto.siblings.full as sibling (sibling.id)}<li>
				<PersonLink person={sibling} href={personPath(treeId, sibling.id)} {relativeTarget} />
			</li>{/each}
		{#each dto.siblings.half as sibling (sibling.id)}<li>
				<PersonLink person={sibling} href={personPath(treeId, sibling.id)} {relativeTarget} />
				<span class="text-xs text-stone-500">half-sibling</span>
			</li>{/each}
	</ul>
</div>

{#if dto.stepParents.length > 0 || dto.stepChildren.length > 0}
	<div class="space-y-2">
		<h4 class={subheading}>Step relatives</h4>
		<ul class="space-y-0.5 text-sm" data-testid="step-relatives">
			{#each dto.stepParents as step (step.person.id)}<li>
					<PersonLink
						person={step.person}
						href={personPath(treeId, step.person.id)}
						{relativeTarget}
					/>
					<span class="text-xs text-stone-500">step-parent</span>
				</li>{/each}
			{#each dto.stepChildren as step (step.person.id)}<li>
					<PersonLink
						person={step.person}
						href={personPath(treeId, step.person.id)}
						{relativeTarget}
					/>
					<span class="text-xs text-stone-500">step-child, via {step.via.displayName}</span>
				</li>{/each}
		</ul>
	</div>
{/if}
