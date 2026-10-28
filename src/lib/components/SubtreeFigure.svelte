<script lang="ts">
	import MarshDrawing from './MarshDrawing.svelte';

	// 700px for 760 units is a scale of 0.92: names (16 units) never render under about 15px and
	// dates (12 units) under about 11px, so a narrower screen pans the drawing instead of shrinking it.
	const MIN_WIDTH_PX = 700;

	let width = $state(0);
	let isAtEnd = $state(false);
	// Below this the names would shrink past reading, so the drawing keeps its size and scrolls.
	const isScrolling = $derived(width > 0 && width < MIN_WIDTH_PX);

	function measureEnd(event: Event) {
		const el = event.currentTarget as HTMLElement;
		isAtEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
	}
</script>

<figure class="subtree">
	<!-- Focusable only while it scrolls, so a keyboard can pan it; a scrolling region is the one
	non-control that should take focus. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="scroller"
		class:has-more={isScrolling && !isAtEnd}
		bind:clientWidth={width}
		onscroll={measureEnd}
		tabindex={isScrolling ? 0 : undefined}
		role={isScrolling ? 'region' : undefined}
		aria-label={isScrolling ? 'Sub-tree drawing, scrolls sideways' : undefined}
		aria-describedby={isScrolling ? 'subtree-caption' : undefined}
	>
		<MarshDrawing
			labelledBy="subtree-caption"
			tab="Starts here"
			isLensOn
			minWidthPx={MIN_WIDTH_PX}
		/>
	</div>
	<figcaption id="subtree-caption">
		The Marsh line in the sample family above, drawn as far as William Marsh’s grandchildren.
		Everyone descended from him and their partners are in it, Henry’s adoption and Nell’s fostering
		included. William’s parents and Mary’s are not.
	</figcaption>
</figure>

<style>
	.subtree {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.scroller {
		overflow-x: auto;
		border: 1px solid var(--stone-rule);
		border-radius: 16px;
		background: var(--tree-paper);
		scrollbar-width: thin;
		scrollbar-color: var(--stone-edge) transparent;
	}

	/* The half of the family past the edge fades out, so a phone shows there is more to pan to. */
	.scroller.has-more {
		mask-image: linear-gradient(to left, transparent, #1c1917 40px);
	}

	.scroller:focus-visible {
		outline-offset: 3px;
	}

	/* The drawing's lens runs on the figure's timeline, named, because a bare view() would bind to
	the sideways scroller and never run. */
	.subtree {
		view-timeline: --lens block;
	}

	figcaption {
		font-size: var(--site-small);
		line-height: 1.55;
		color: var(--stone-text);
		max-width: 62ch;
	}
</style>
