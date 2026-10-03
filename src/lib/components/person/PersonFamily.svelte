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
</script>

<section aria-labelledby="parents-heading" class="section-card">
	<h3 id="parents-heading" class="section-heading">Parents</h3>
	{#if dto.parentFamilies.length === 0}<p class="mt-2 text-xs text-stone-500 italic">
			None recorded.
		</p>{/if}
	{#each dto.parentFamilies as family (family.unionId ?? 'direct')}
		<ul class="mt-2 space-y-1 text-sm" data-testid="parents">
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
</section>

<section aria-labelledby="partners-heading" class="section-card">
	<h3 id="partners-heading" class="section-heading">Partnerships and children</h3>
	{#if dto.partnerships.length === 0 && dto.directChildren.length === 0}<p
			class="mt-2 text-xs text-stone-500 italic"
		>
			None recorded.
		</p>{/if}
	{#each dto.partnerships as union (union.unionId)}
		<div
			class="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5"
			data-testid="partnership"
		>
			<p class="text-xs font-semibold text-amber-900">
				<a class="row-link" href={unionPath(treeId, union.unionId)}
					>{union.label?.full ?? 'Partnership'}</a
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
		<p class="mt-3 text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
			Children (no partnership recorded)
		</p>
		<ul class="space-y-0.5 text-sm">
			{#each childrenOf(dto.directChildren) as child (child.id)}
				<li><PersonLink person={child} href={personPath(treeId, child.id)} {relativeTarget} /></li>
			{/each}
		</ul>
	{/if}
</section>

<section aria-labelledby="siblings-heading" class="section-card">
	<h3 id="siblings-heading" class="section-heading">Siblings</h3>
	{#if dto.siblings.full.length === 0 && dto.siblings.half.length === 0}<p
			class="mt-2 text-xs text-stone-500 italic"
		>
			None recorded.
		</p>{/if}
	<ul class="mt-2 space-y-0.5 text-sm" data-testid="siblings">
		{#each dto.siblings.full as sibling (sibling.id)}<li>
				<PersonLink person={sibling} href={personPath(treeId, sibling.id)} {relativeTarget} />
			</li>{/each}
		{#each dto.siblings.half as sibling (sibling.id)}<li>
				<PersonLink person={sibling} href={personPath(treeId, sibling.id)} {relativeTarget} />
				<span class="text-xs text-stone-500">half-sibling</span>
			</li>{/each}
	</ul>
</section>

{#if dto.stepParents.length > 0 || dto.stepChildren.length > 0}
	<section aria-labelledby="steps-heading" class="section-card">
		<h3 id="steps-heading" class="section-heading">Step relatives</h3>
		<ul class="mt-2 space-y-0.5 text-sm" data-testid="step-relatives">
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
	</section>
{/if}
