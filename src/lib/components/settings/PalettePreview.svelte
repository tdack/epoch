<script lang="ts">
	import { treeTokenStyle, type Palette, type SexKey } from '#lib/components/tree/palette.js';
	import { SEX_COLOUR_LABELS } from '#lib/shared/settings.js';

	interface Props {
		/** The palette to show; already resolved, so every colour is six-digit hex. */
		palette: Palette;
		/** Names the preview for assistive technology, such as "Preview of your colours". */
		label: string;
	}

	let { palette, label }: Props = $props();

	const SEXES: readonly SexKey[] = ['male', 'female', 'unknown'];
	const CARD_CLASS: Readonly<Record<SexKey, string>> = { male: 'm', female: 'f', unknown: 'u' };
	const FOCUS_LINES = [
		{ key: 'ancestor', label: 'Ancestors' },
		{ key: 'descendant', label: 'Descendants' },
		{ key: 'partner', label: 'Partners' }
	] as const;
</script>

<!-- The same custom properties the flat view's root carries, scoped to this panel, so the sample
     cards are drawn exactly as the tree would draw them. -->
<figure class="preview" style={treeTokenStyle(palette)} aria-label={label}>
	<div class="flex flex-wrap gap-3">
		{#each SEXES as sex (sex)}
			<div class="card {CARD_CLASS[sex]}">
				<span class="name">{SEX_COLOUR_LABELS[sex]}</span>
				<span class="years">1901–1979</span>
			</div>
		{/each}
	</div>

	<div class="stage mt-3" role="group" aria-label="On the dark 3D stage">
		{#each SEXES as sex (sex)}
			<span class="flex items-center gap-1.5">
				<i class="sphere" style:background-color={palette.sex[sex].sphere}></i>
				<i class="star" style:background-color={palette.sex[sex].star}></i>
				<span>{SEX_COLOUR_LABELS[sex]}</span>
			</span>
		{/each}
		{#each FOCUS_LINES as line (line.key)}
			<span class="flex items-center gap-1.5">
				<i class="line" style:background-color={palette.focusDark[line.key]}></i>
				<span>{line.label}</span>
			</span>
		{/each}
	</div>

	<div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone-700">
		{#each FOCUS_LINES as line (line.key)}
			<span class="flex items-center gap-1.5">
				<i class="line" style:background-color={palette.focus[line.key]}></i>
				{line.label}
			</span>
		{/each}
	</div>

	<div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone-700">
		{#each palette.trace as colour, index (index)}
			<span class="chip" style:--chip={colour}>Trace {index + 1}</span>
		{/each}
		<span class="chip" style:--chip={palette.intersection}>Where traces meet</span>
	</div>
	<figcaption class="mt-2 text-xs text-stone-600">
		A preview only: the tree repaints once you save.
	</figcaption>
</figure>

<style>
	.preview {
		margin: 0;
		border: 1px solid var(--tree-panel-border);
		border-radius: 0.75rem;
		background: var(--tree-bg);
		padding: 0.75rem;
	}
	.card {
		display: flex;
		min-width: 8rem;
		flex-direction: column;
		border: 2px solid;
		border-radius: 0.5rem;
		padding: 0.375rem 0.625rem;
		color: var(--tree-ink);
		font-size: 0.8125rem;
	}
	.card.m {
		background: var(--sex-m);
		border-color: var(--sex-m-border);
	}
	.card.f {
		background: var(--sex-f);
		border-color: var(--sex-f-border);
	}
	.card.u {
		background: var(--sex-u);
		border-color: var(--sex-u-border);
	}
	.name {
		font-weight: 600;
	}
	.years {
		color: var(--tree-ink-muted);
	}
	.stage {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		border-radius: 0.5rem;
		background: #10141f;
		padding: 0.625rem 0.75rem;
		color: #f4eedc;
		font-size: 0.75rem;
	}
	i {
		display: inline-block;
	}
	.sphere,
	.star {
		width: 0.875rem;
		height: 0.875rem;
		border-radius: 9999px;
	}
	.star {
		width: 0.625rem;
		height: 0.625rem;
	}
	.line {
		width: 1.5rem;
		height: 0.1875rem;
		border-radius: 9999px;
	}
	.chip {
		border: 2px solid var(--chip);
		border-radius: 9999px;
		padding: 0.125rem 0.5rem;
		background: color-mix(in srgb, var(--chip) 18%, white);
	}
</style>
