<script lang="ts">
	import MarshDrawing from './MarshDrawing.svelte';

	// The spread keeps this width and the figure pans on a narrower screen. It is a picture of a
	// printed sheet, so it may sit smaller than the sub-trees drawing, but its names (16 units) stay
	// at about 11px.
	const MIN_WIDTH_PX = 600;

	let width = $state(0);
	let isAtEnd = $state(false);
	const isScrolling = $derived(width > 0 && width < MIN_WIDTH_PX);

	function measureEnd(event: Event) {
		const el = event.currentTarget as HTMLElement;
		isAtEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
	}
</script>

<!-- The family view as it prints: one white sheet cut to the drawing, with the app's print footer.
The rules beside it say how the sheet is sized: the short side up to A0's, the long side running on. -->
<figure class="poster">
	<!-- Focusable only while it scrolls, so a keyboard can pan it. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="pan"
		class:has-more={isScrolling && !isAtEnd}
		bind:clientWidth={width}
		onscroll={measureEnd}
		tabindex={isScrolling ? 0 : undefined}
		role={isScrolling ? 'region' : undefined}
		aria-label={isScrolling ? 'Poster drawing, scrolls sideways' : undefined}
		aria-describedby={isScrolling ? 'poster-caption' : undefined}
	>
		<div class="spread" style:min-width="{MIN_WIDTH_PX}px">
			<div class="sheet">
				<MarshDrawing
					labelledBy="poster-caption"
					tab="Focus"
					hasGrid={false}
					minWidthPx={MIN_WIDTH_PX - 72}
				/>
				<p class="footer" aria-hidden="true">
					<span>The Marsh family</span>
					<span>28 October 2026 · Viewer</span>
				</p>
			</div>
			<div class="rule short" aria-hidden="true"><span>up to 841 mm</span></div>
			<div class="rule long" aria-hidden="true"><span>as long as the family needs</span></div>
		</div>
	</div>
	<figcaption id="poster-caption">
		The sample family’s view as it prints: every card at full detail on one sheet cut to the
		drawing, with the tree, the day and the reader’s role in the footer.
	</figcaption>
</figure>

<style>
	.poster {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.pan {
		overflow-x: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--stone-edge) transparent;
	}

	/* The part of the sheet past the edge fades out, so a phone shows there is more to pan to. */
	.pan.has-more {
		mask-image: linear-gradient(to left, transparent, #1c1917 40px);
	}

	.pan:focus-visible {
		outline-offset: 3px;
	}

	.spread {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 40px;
		grid-template-rows: auto 40px;
	}

	/* Paper on the desk: white because it is printed, lifted only a little because it lies flat. */
	.sheet {
		padding: 16px 16px 10px;
		background: var(--field-white);
		border: 1px solid var(--stone-rule);
		border-radius: var(--radius-md);
		box-shadow: 0 6px 18px rgb(41 37 36 / 0.08);
	}

	.footer {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		margin: 6px 0 0;
		padding-top: 6px;
		border-top: 1px solid var(--stone-rule);
		font-size: var(--site-label);
		color: var(--stone-text);
		font-variant-numeric: tabular-nums;
	}

	/* Dimension rules, drawn as a printer's are: a hairline between two end ticks, the label sitting
	on it. The long side's runs out dashed, because the sheet keeps going as the family widens. */
	.rule {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--emerald-800);
		font-size: var(--site-label);
		font-weight: 600;
		white-space: nowrap;
	}

	.rule span {
		position: relative;
		background: var(--page-cream);
	}

	.rule.short {
		margin-left: 14px;
		border-block: 1.5px solid currentColor;
		background: linear-gradient(currentColor, currentColor) center / 1.5px 100% no-repeat;
		width: 12px;
		justify-self: start;
	}

	.rule.short span {
		writing-mode: vertical-rl;
		padding: 8px 0;
	}

	.rule.long {
		margin-top: 14px;
		height: 12px;
		align-self: start;
		border-left: 1.5px solid currentColor;
		background:
			linear-gradient(currentColor, currentColor) left center / calc(100% - 56px) 1.5px no-repeat,
			repeating-linear-gradient(to right, currentColor 0 6px, transparent 6px 11px) right center /
				56px 1.5px no-repeat;
	}

	.rule.long span {
		padding: 0 10px;
	}

	figcaption {
		font-size: var(--site-small);
		line-height: 1.55;
		color: var(--stone-text);
		max-width: 62ch;
	}
</style>
