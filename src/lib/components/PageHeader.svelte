<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** The page's h1. */
		title: string;
		/** One or two sentences under the title. */
		lede: string;
		/** Anything that follows the lede, such as a link. */
		children?: Snippet;
	}

	let { title, lede, children }: Props = $props();
</script>

<!-- The compact header of a page below the home page: the hero's emerald ground and vellum type,
without the photograph, the mark or the action. The sticky nav overlaps its top by its own height,
so the padding starts below it. -->
<header class="head">
	<div class="inner">
		<a class="back" href="/">
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.4"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6" /></svg
			>
			Back to the home page
		</a>
		<h1>{title}</h1>
		<p class="lede">{lede}</p>
		{@render children?.()}
	</div>
</header>

<style>
	.head {
		color: var(--vellum);
		background: linear-gradient(
			160deg,
			var(--emerald-950) 0%,
			var(--emerald-900) 55%,
			var(--emerald-950) 100%
		);
	}

	.inner {
		max-width: var(--measure);
		margin: 0 auto;
		padding: calc(var(--nav-height) + clamp(16px, 3vw, 32px)) var(--gutter) clamp(48px, 6vw, 72px);
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: clamp(14px, 2vw, 20px);
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		color: var(--emerald-100);
		font-weight: 600;
		font-size: var(--site-small);
		text-decoration: none;
	}

	.back:hover {
		color: var(--vellum);
	}

	.head :focus-visible {
		outline-color: var(--amber-300);
		outline-offset: 4px;
	}

	h1 {
		margin: 0;
		color: var(--vellum);
		font-size: var(--site-display);
		line-height: 1.1;
		letter-spacing: -0.025em;
		font-weight: 700;
	}

	.lede {
		margin: 0;
		max-width: 46ch;
		color: var(--emerald-200);
		font-size: var(--site-lede);
		line-height: 1.6;
	}
</style>
