<script lang="ts">
	import { CARD, type ChartLayout } from '#lib/charts/chart-layout.js';

	interface Props {
		/** Where every card and link goes. */
		layout: ChartLayout;
		/** Names the chart for assistive technology. */
		label: string;
		/** Where a card leads: the chart of that person. Not called for a "Private" card. */
		hrefFor: (personId: string) => string;
	}

	let { layout, label, hrefFor }: Props = $props();

	const PADDING = 8;
	const byKey = $derived(new Map(layout.cards.map((c) => [c.key, c])));

	/** An elbow between the near edges of two cards: right to left going right, left to right going left (an hourglass has both). */
	function path(from: string, to: string): string {
		const a = byKey.get(from)!;
		const b = byKey.get(to)!;
		const isLeftward = b.x < a.x;
		const x1 = isLeftward ? a.x : a.x + CARD.width;
		const y1 = a.y + CARD.height / 2;
		const x2 = isLeftward ? b.x + CARD.width : b.x;
		const y2 = b.y + CARD.height / 2;
		const mid = (x1 + x2) / 2;
		return `M${x1} ${y1} H${mid} V${y2} H${x2}`;
	}

	const dates = (birth: string | null, death: string | null) =>
		birth || death ? `${birth ?? '?'} – ${death ?? ''}`.trim() : '';
</script>

<div class="overflow-auto rounded-xl border border-stone-200 bg-white" tabindex="-1">
	<svg
		role="group"
		aria-label={label}
		width={layout.width + PADDING * 2}
		height={layout.height + PADDING * 2}
		viewBox="{-PADDING} {-PADDING} {layout.width + PADDING * 2} {layout.height + PADDING * 2}"
		class="block"
	>
		<g fill="none" stroke="currentColor" class="text-stone-300" aria-hidden="true">
			{#each layout.edges as edge (`${edge.from}-${edge.to}`)}
				<path d={path(edge.from, edge.to)} stroke-width="1.5" />
			{/each}
		</g>
		{#each layout.cards as card (card.key)}
			{@const person = card.person}
			{@const partners = card.partners ?? []}
			{#snippet face()}
				<rect
					width={CARD.width}
					height={CARD.height}
					rx="8"
					class={person.isPrivate
						? 'fill-stone-50 stroke-stone-300'
						: 'fill-emerald-50 stroke-emerald-300'}
					stroke-width="1.2"
					stroke-dasharray={person.isPrivate ? '4 3' : undefined}
				/>
				<text
					x="10"
					y="19"
					class="fill-stone-900 text-[12px] font-semibold"
					font-style={person.isPrivate ? 'italic' : undefined}
					>{person.name.length > 24 ? `${person.name.slice(0, 23)}…` : person.name}</text
				>
				<text x="10" y="34" class="fill-stone-600 text-[10px]"
					>{dates(person.birth, person.death)}{#if partners.length > 0}{dates(
							person.birth,
							person.death
						)
							? ' · '
							: ''}with {partners
							.map((p) => p.name)
							.join(', ')
							.slice(0, 22)}{/if}</text
				>
			{/snippet}
			<g transform="translate({card.x} {card.y})" data-testid="chart-card">
				{#if person.isPrivate}
					{@render face()}
				{:else}
					<a
						href={hrefFor(person.id)}
						aria-label="{person.name}{dates(person.birth, person.death)
							? `, ${dates(person.birth, person.death)}`
							: ''}. Chart this person"
					>
						{@render face()}
					</a>
				{/if}
			</g>
		{/each}
	</svg>
</div>
