<script lang="ts">
	import type { FanLayout } from '#lib/charts/fan-layout.js';

	interface Props {
		layout: FanLayout;
		/** Names the chart for assistive technology. */
		label: string;
		/** Where a wedge leads: the chart of that person. Not called for a "Private" wedge. */
		hrefFor: (personId: string) => string;
	}

	let { layout, label, hrefFor }: Props = $props();

	const dates = (birth: string | null, death: string | null) =>
		birth || death ? `${birth ?? '?'} – ${death ?? ''}`.trim() : '';
</script>

<div class="overflow-auto rounded-xl border border-stone-200 bg-white" tabindex="-1">
	<svg
		role="group"
		aria-label={label}
		width={layout.width}
		height={layout.height}
		viewBox="0 0 {layout.width} {layout.height}"
		class="mx-auto block"
	>
		{#each layout.segments as segment (segment.key)}
			{@const person = segment.person}
			{@const summary = `${person.name}${dates(person.birth, person.death) ? `, ${dates(person.birth, person.death)}` : ''}`}
			{#snippet face()}
				<title>{summary}</title>
				<path
					d={segment.path}
					class={person.isPrivate
						? 'fill-stone-50 stroke-stone-300'
						: segment.generation % 2 === 0
							? 'fill-emerald-100 stroke-emerald-300'
							: 'fill-emerald-50 stroke-emerald-300'}
					stroke-width="1.2"
					stroke-dasharray={person.isPrivate ? '4 3' : undefined}
				/>
				<text
					transform="translate({segment.label.x} {segment.label.y}) rotate({segment.label.rotate})"
					text-anchor="middle"
					class="pointer-events-none fill-stone-900 text-[11px] font-semibold"
					font-style={person.isPrivate ? 'italic' : undefined}
					aria-hidden="true"
				>
					{#each segment.label.lines as line, i (i)}
						<tspan
							x="0"
							dy={i === 0 ? (segment.label.lines.length > 1 ? -2 : 4) : 12}
							class={i === 0 ? '' : 'fill-stone-600 text-[10px] font-normal'}>{line}</tspan
						>
					{/each}
				</text>
			{/snippet}
			<g data-testid="chart-card">
				{#if person.isPrivate}
					{@render face()}
				{:else}
					<a href={hrefFor(person.id)} aria-label="{summary}. Chart this person">
						{@render face()}
					</a>
				{/if}
			</g>
		{/each}
	</svg>
</div>
