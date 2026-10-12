<script lang="ts">
	interface Props {
		/** Ink of the line and its node; `mist` is for the dark emerald sections. */
		tone?: 'emerald' | 'mist' | 'vellum';
		/** Draw the node as the amber child of the mark rather than an ink partner. */
		isFocus?: boolean;
	}

	let { tone = 'emerald', isFocus = false }: Props = $props();
</script>

<!-- The line of descent that carries the mark's stem from one section to the next. Decoration:
the section heading that follows names the place. -->
<div class="descent {tone}" class:focus={isFocus} aria-hidden="true">
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

	.mist {
		--ink: var(--emerald-mist);
	}

	.vellum {
		--ink: var(--vellum);
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
