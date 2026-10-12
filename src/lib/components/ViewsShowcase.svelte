<script lang="ts">
	import Descent from './Descent.svelte';
	import ViewIllustration from './ViewIllustration.svelte';
	import { DEMO_URL, VIEWS_3D } from '#lib/site.js';

	let runway = $state<HTMLElement>();
	let track = $state<HTMLElement>();

	/** Whether vertical scrolling drives the panels sideways; off on narrow screens and under reduced motion. */
	let isPinned = $state(false);
	let isAnimated = $state(false);
	let offsetPx = $state(0);
	let travelPx = $state(0);

	$effect(() => {
		if (!runway || !track) return;
		const wide = matchMedia('(min-width: 900px) and (min-height: 600px)');
		const still = matchMedia('(prefers-reduced-motion: reduce)');
		const runwayEl = runway;
		const trackEl = track;
		let frame = 0;

		const measure = () => {
			isAnimated = !still.matches;
			isPinned = wide.matches && !still.matches;
			// The distance the track must travel so its last panel ends at the right edge.
			travelPx = isPinned ? Math.max(0, trackEl.scrollWidth - trackEl.clientWidth) : 0;
			update();
		};

		const update = () => {
			frame = 0;
			if (!isPinned) {
				offsetPx = 0;
				return;
			}
			const scrolled = -runwayEl.getBoundingClientRect().top;
			offsetPx = Math.min(travelPx, Math.max(0, scrolled));
		};

		const onScroll = () => {
			if (!frame) frame = requestAnimationFrame(update);
		};

		measure();
		const resize = new ResizeObserver(measure);
		resize.observe(trackEl);
		wide.addEventListener('change', measure);
		still.addEventListener('change', measure);
		addEventListener('scroll', onScroll, { passive: true });
		return () => {
			resize.disconnect();
			wide.removeEventListener('change', measure);
			still.removeEventListener('change', measure);
			removeEventListener('scroll', onScroll);
			cancelAnimationFrame(frame);
		};
	});
</script>

<section id="views" class="views" class:is-pinned={isPinned} aria-labelledby="views-title">
	<Descent tone="mist" />
	<!-- While pinned, this runway is taller than the screen by exactly the track's travel, so the
	page scrolls on as soon as the last panel has arrived. -->
	<div
		class="runway"
		bind:this={runway}
		style:height={isPinned ? `calc(100vh + ${travelPx}px)` : undefined}
	>
		<div class="pin">
			<div class="head">
				<h2 id="views-title">Four more ways to see the whole family</h2>
				<p>
					Beside the flat family view, four 3D views. Each can show the whole tree and trace several
					lines at once.
				</p>
			</div>

			<ul class="track" bind:this={track} style:translate="{-offsetPx}px 0">
				{#each VIEWS_3D as view, i (view.id)}
					<li class="panel">
						<div class="stage">
							{#if view.video}
								<video
									src={view.video}
									poster={view.poster}
									preload={isAnimated ? 'auto' : 'none'}
									controls={!isAnimated}
									muted
									loop
									playsinline
									autoplay={isAnimated}
									aria-label="A recording of the {view.name} view"
								></video>
							{:else}
								<ViewIllustration view={view.id} {isAnimated} />
								<span class="tag">Illustration</span>
							{/if}
						</div>
						<div class="caption">
							<h3><span class="count">{i + 1} of {VIEWS_3D.length}</span>{view.name}</h3>
							<p>{view.text}</p>
						</div>
					</li>
				{/each}
			</ul>

			<p class="foot"><a href={DEMO_URL}>Turn them yourself in the demo</a></p>
		</div>
	</div>
</section>

<style>
	.views {
		position: relative;
		background: var(--emerald-900);
		color: var(--vellum);
	}

	.pin {
		display: flex;
		flex-direction: column;
		padding-bottom: clamp(56px, 7vw, 88px);
		overflow: hidden;
	}

	.is-pinned .pin {
		position: sticky;
		top: 0;
		height: 100vh;
		justify-content: center;
		padding-bottom: 32px;
	}

	.head {
		max-width: 760px;
		margin: 0 auto;
		padding: 0 var(--gutter);
		text-align: center;
	}

	h2 {
		margin: 0 0 12px;
		color: var(--vellum);
		font-size: clamp(2rem, 4.2vw, 2.875rem);
		line-height: 1.1;
		letter-spacing: -0.02em;
	}

	.head p {
		margin: 0 auto clamp(28px, 3.5vw, 40px);
		max-width: 56ch;
		color: var(--emerald-200);
		font-size: clamp(1.0625rem, 1.5vw, 1.1875rem);
	}

	.track {
		--panel: min(78vw, 820px, calc((100vh - 330px) * 1.75));
		display: flex;
		gap: clamp(20px, 3vw, 40px);
		list-style: none;
		margin: 0;
		/* The first panel starts on the page's content edge and the last can end on it too. */
		padding: 0 max(var(--gutter), calc((100vw - var(--measure)) / 2 + var(--gutter)));
		will-change: translate;
	}

	.views:not(.is-pinned) .track {
		--panel: min(84vw, 640px);
		overflow-x: auto;
		scroll-snap-type: x mandatory;
		scroll-padding-inline: var(--gutter);
		padding-bottom: 12px;
		scrollbar-color: rgb(110 231 183 / 0.35) transparent;
	}

	.views:not(.is-pinned) .stage {
		aspect-ratio: 16 / 10;
	}

	/* A flex row drops a scroller's end padding, so this spacer keeps the last panel off the edge. */
	.track::after {
		content: '';
		flex: none;
		width: 1px;
	}

	.panel {
		flex: none;
		width: var(--panel);
		scroll-snap-align: start;
	}

	.stage {
		position: relative;
		aspect-ratio: 16 / 7.5;
		border-radius: 16px;
		overflow: hidden;
		/* Emerald night rather than the app's slate stage, so the panels belong to this page. */
		background: radial-gradient(120% 90% at 50% 30%, #0b3b2e 0%, var(--emerald-950) 70%);
		border: 1px solid rgb(110 231 183 / 0.18);
		box-shadow: 0 18px 40px rgb(2 44 34 / 0.45);
	}

	.stage video {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.tag {
		position: absolute;
		right: 12px;
		bottom: 10px;
		padding: 3px 10px;
		border-radius: 9999px;
		background: rgb(2 44 34 / 0.8);
		color: var(--emerald-200);
		font-size: 0.75rem;
		font-style: italic;
	}

	.caption {
		padding-top: 18px;
		max-width: 60ch;
	}

	h3 {
		display: flex;
		align-items: baseline;
		gap: 12px;
		margin: 0 0 6px;
		color: var(--vellum);
		font-size: 1.375rem;
	}

	.count {
		color: var(--emerald-mist);
		font-size: 0.8125rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.caption p {
		margin: 0;
		color: var(--emerald-200);
	}

	.foot {
		margin: clamp(24px, 3vw, 32px) 0 0;
		text-align: center;
	}

	.foot a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		color: var(--emerald-100);
		font-weight: 600;
	}

	.foot a:hover {
		color: var(--vellum);
	}

	.views :focus-visible {
		outline-color: var(--amber-300);
		outline-offset: 3px;
	}
</style>
