<script lang="ts">
	interface Props {
		/** Ink of the line and its node; `mist` is for the dark emerald sections. */
		tone?: 'emerald' | 'mist' | 'vellum';
		/** Draw the node as the amber child of the mark rather than an ink partner. */
		isFocus?: boolean;
		/**
		 * What the line descends from: the plain stem, the faded ancestors' bar at the top of the
		 * mark, or a partnership (two partners and the app's union marker).
		 */
		origin?: 'stem' | 'ancestors' | 'union';
	}

	let { tone = 'emerald', isFocus = false, origin = 'stem' }: Props = $props();
</script>

<!-- The line of descent that carries the mark's stem from one section to the next. Decoration:
the section heading that follows names the place. -->
<div class="descent {tone} from-{origin}" class:focus={isFocus} aria-hidden="true">
	{#if origin === 'ancestors'}
		<svg class="origin ancestors" viewBox="0 0 120 22" width="120" height="22">
			<circle cx="11" cy="11" r="9" />
			<circle cx="109" cy="11" r="9" />
			<path d="M20 11H100M60 11V22" />
		</svg>
	{:else if origin === 'union'}
		<!-- The union marker as the app draws it: a disc holding two linked rings. -->
		<svg class="origin union" viewBox="0 0 160 30" width="160" height="30">
			<circle cx="12" cy="15" r="9" />
			<circle cx="148" cy="15" r="9" />
			<path d="M21 15H67M93 15H139M80 28V30" />
			<circle class="disc" cx="80" cy="15" r="13" />
			<circle class="ring" cx="76.8" cy="15" r="4.6" />
			<circle class="ring" cx="83.2" cy="15" r="4.6" />
		</svg>
	{/if}
	<span class="line"></span>
	<span class="node"></span>
</div>

<style>
	.descent {
		--ink: var(--emerald-800);
		display: flex;
		flex-direction: column;
		align-items: center;
		padding-bottom: clamp(32px, 4vw, 48px);
	}

	/* A plain stem carries on from the section above, so it starts at the edge. A bar has nothing
	above it: it starts a line, and needs room, or it reads as caught on the edge. */
	.from-ancestors,
	.from-union {
		padding-top: clamp(28px, 3.5vw, 44px);
	}

	.mist {
		--ink: var(--emerald-mist);
	}

	.vellum {
		--ink: var(--vellum);
	}

	.origin {
		display: block;
		overflow: visible;
		fill: var(--ink);
		stroke: var(--ink);
		stroke-width: 3;
	}

	/* The ancestors sit above the page's line, so they are drawn faint, as the mark draws them. */
	.ancestors {
		opacity: 0.42;
	}

	.union .disc {
		fill: var(--union-fill, #fdfbf7);
		stroke: var(--union-ink, #8a5a14);
		stroke-width: 1.5;
	}

	.union .ring {
		fill: none;
		stroke: var(--union-ink, #8a5a14);
		stroke-width: 1.5;
	}

	.line {
		width: 3px;
		height: clamp(56px, 7vw, 88px);
		background: var(--ink);
		transform-origin: top;
	}

	.node {
		width: 18px;
		height: 18px;
		border-radius: 9999px;
		background: var(--ink);
	}

	/* The ancestors are faint, and the line comes into full ink as it reaches this generation,
	so the faint stub and the line meet without a seam. 42% matches the bar's opacity. */
	.from-ancestors .line {
		background: linear-gradient(color-mix(in srgb, var(--ink) 42%, transparent), var(--ink) 55%);
	}

	.focus .node {
		width: 28px;
		height: 28px;
		background: var(--amber);
	}

	/* The line draws itself as it scrolls into view, so the page reads as one line of descent.
	Browsers without scroll timelines, and reduced motion, simply show it drawn. */
	@supports (animation-timeline: view()) {
		@media (prefers-reduced-motion: no-preference) {
			.line {
				animation: draw linear both;
				animation-timeline: view();
				animation-range: entry 10% cover 35%;
			}

			.node {
				animation: seat linear both;
				animation-timeline: view();
				animation-range: entry 30% cover 40%;
			}
		}
	}

	@keyframes draw {
		from {
			transform: scaleY(0);
		}
		to {
			transform: scaleY(1);
		}
	}

	@keyframes seat {
		from {
			transform: scale(0.2);
			opacity: 0;
		}
		to {
			transform: scale(1);
			opacity: 1;
		}
	}
</style>
