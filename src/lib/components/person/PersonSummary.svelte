<script lang="ts">
	import { NAME_TYPE_LABELS, splitDisplayName } from '#lib/shared/name-types.js';
	import { sexLabel } from '#lib/shared/sex.js';
	import { ageAt, birthSpan } from '#lib/shared/age.js';
	import type { NameDto, PersonPageDto } from '#lib/shared/person-page.js';

	interface Props {
		dto: PersonPageDto;
		/** The person page's one h1; in the drawer the name sits under the tree page's own h1. */
		isPageTitle: boolean;
		/** The signed-in member says this is them; private to that member. */
		isSelf?: boolean;
	}

	let { dto, isPageTitle, isSelf = false }: Props = $props();

	/** First letter of the first given name and of the surname: "Jane Mary Doe" is JD. */
	const initials = $derived.by(() => {
		const first = dto.person.givenName?.trim().split(/\s+/)[0]?.[0];
		const last = dto.person.surname?.trim().split(/\s+/).at(-1)?.[0];
		const fromName = [first, last].filter(Boolean).join('');
		if (fromName) return fromName;
		const words = splitDisplayName(dto.person.displayName).name.trim().split(/\s+/).filter(Boolean);
		return (
			(words.length > 1 ? words[0]![0]! + words.at(-1)![0]! : (words[0]?.slice(0, 2) ?? '')) || '?'
		);
	});

	const deathAge = $derived.by(() => {
		const birth = birthSpan(dto.facts);
		const death = dto.vitals.death;
		return birth && death && !death.age ? ageAt(birth, death) : null;
	});
	/** The names the person is not shown by; they are edited under Names. */
	const otherNames = $derived(dto.names.filter((n) => !n.isPreferred && n.id !== null));
	const nameNote = (n: NameDto) =>
		n.type === 'other' && n.gedcomType ? n.gedcomType : NAME_TYPE_LABELS[n.type].toLowerCase();
</script>

<div class="flex items-center gap-4">
	<div
		class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-emerald-300 bg-emerald-50 text-emerald-800 shadow-xs"
		aria-hidden="true"
	>
		<span class="text-lg font-bold uppercase" data-testid="initials">{initials}</span>
	</div>
	<div class="min-w-0">
		<!-- Focusable so the drawer can move focus here when it opens. -->
		<svelte:element
			this={isPageTitle ? 'h1' : 'h2'}
			class="text-2xl font-bold text-stone-900"
			data-testid="person-name"
			tabindex="-1"
		>
			{dto.person.displayName}
		</svelte:element>
		{#if isSelf}<span
				class="mt-1 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900"
				data-testid="you-badge">You<span class="sr-only"> (this is you)</span></span
			>{/if}
		<p class="mt-1 text-sm text-stone-600">
			{sexLabel(dto.person.sex)}{#if dto.vitals.lifespan}<span aria-hidden="true">{' · '}</span
				><span data-testid="lifespan">{dto.vitals.lifespan}</span>{/if}{#if deathAge}<span
					aria-hidden="true">{' · '}</span
				><span data-testid="death-age" title="Calculated from the birth date"
					>{deathAge}<span class="sr-only">, calculated from the birth date</span></span
				>{/if}
			{#if dto.vitals.hasConflict}<span
					class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900"
					>dates disagree</span
				>{/if}
		</p>
		{#if otherNames.length > 0}
			<ul class="mt-1 space-y-0.5 text-xs text-stone-600" data-testid="drawer-names">
				{#each otherNames as n (n.id)}
					<li>{n.displayName} <span class="text-stone-500">({nameNote(n)})</span></li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
