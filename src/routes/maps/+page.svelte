<script lang="ts">
	import Descent from '#lib/components/Descent.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import PlacesMapFigure from '#lib/components/PlacesMapFigure.svelte';
	import RichText from '#lib/components/RichText.svelte';
	import SiteFooter from '#lib/components/SiteFooter.svelte';
	import { DEMO_PLACES_URL, MAP_PRIVACY, MAPS_NOTE, MAPS_PAGE, SITE_URL } from '#lib/site.js';
</script>

<svelte:head>
	<title>{MAPS_PAGE.title} · Epoch</title>
	<meta name="description" content={MAPS_PAGE.description} />
	<link rel="canonical" href="{SITE_URL}{MAPS_PAGE.path}" />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Epoch" />
	<meta property="og:title" content="{MAPS_PAGE.title} · Epoch" />
	<meta property="og:description" content={MAPS_PAGE.description} />
	<meta property="og:url" content="{SITE_URL}{MAPS_PAGE.path}" />
	<meta property="og:image" content="{SITE_URL}/brand/og-image.png" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<PageHeader title={MAPS_PAGE.title} lede={MAPS_PAGE.lede} />

<main>
	<section class="maps" aria-label="Places and maps">
		<div class="wrap">
			<Descent />

			<div class="grid">
				<div class="stack">
					{#each MAPS_PAGE.paragraphs as paragraph (paragraph)}
						<p><RichText text={paragraph} /></p>
					{/each}
				</div>
				<PlacesMapFigure />
				<div class="scope">
					<div>
						<h2 class="label">What leaves your install</h2>
						<ul>
							{#each MAP_PRIVACY.sent as item (item)}
								<li>{item}</li>
							{/each}
						</ul>
					</div>
					<div>
						<h2 class="label">What never leaves</h2>
						<ul>
							{#each MAP_PRIVACY.never as item (item)}
								<li>{item}</li>
							{/each}
						</ul>
					</div>
					<p class="note">{MAPS_NOTE}</p>
				</div>
			</div>
		</div>
	</section>
</main>

<SiteFooter
	title={MAPS_PAGE.closeTitle}
	actionLabel={MAPS_PAGE.closeAction}
	actionHref={DEMO_PLACES_URL}
/>

<style>
	.wrap {
		max-width: var(--measure);
		margin: 0 auto;
		padding: 0 var(--gutter) var(--section-gap);
	}

	.grid {
		display: grid;
		grid-template-columns: minmax(0, 6fr) minmax(0, 5fr);
		gap: clamp(32px, 5vw, 56px) clamp(32px, 5vw, 64px);
		align-items: start;
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.stack p {
		margin: 0;
		color: var(--stone-strong);
		max-width: 62ch;
	}

	.scope {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 20px clamp(28px, 4vw, 56px);
		padding-top: clamp(24px, 3vw, 32px);
		border-top: 1px solid var(--stone-rule);
	}

	.label {
		margin: 0 0 8px;
		font-size: var(--site-label);
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--emerald-800);
	}

	.scope ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.scope li {
		position: relative;
		padding: 3px 0 3px 20px;
		font-size: var(--site-small);
		color: var(--stone-strong);
		line-height: 1.5;
	}

	.scope li::before {
		content: '';
		position: absolute;
		left: 2px;
		top: 0.82em;
		width: 7px;
		height: 7px;
		border-radius: 9999px;
		background: var(--emerald-800);
	}

	.note {
		margin: 0;
		max-width: 62ch;
		color: var(--stone-text);
		font-size: var(--site-small);
		line-height: 1.6;
	}

	@media (max-width: 860px) {
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}

		.scope {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.note {
			grid-column: 1 / -1;
		}
	}

	@media (max-width: 560px) {
		.scope {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
