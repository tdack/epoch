<script lang="ts">
	import Descent from '#lib/components/Descent.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import PosterFigure from '#lib/components/PosterFigure.svelte';
	import RichText from '#lib/components/RichText.svelte';
	import SiteFooter from '#lib/components/SiteFooter.svelte';
	import { DEMO_REPORTS_URL, PRINTING, REPORT_GROUPS, REPORTS_PAGE, SITE_URL } from '#lib/site.js';

	const [aboutPerson, ...others] = REPORT_GROUPS;
</script>

<svelte:head>
	<title>{REPORTS_PAGE.title} · Epoch</title>
	<meta name="description" content={REPORTS_PAGE.description} />
	<link rel="canonical" href="{SITE_URL}{REPORTS_PAGE.path}" />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Epoch" />
	<meta property="og:title" content="{REPORTS_PAGE.title} · Epoch" />
	<meta property="og:description" content={REPORTS_PAGE.description} />
	<meta property="og:url" content="{SITE_URL}{REPORTS_PAGE.path}" />
	<meta property="og:image" content="{SITE_URL}/brand/og-image.png" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<PageHeader title={REPORTS_PAGE.title} lede={REPORTS_PAGE.lede} />

<main>
	<section class="intro" aria-label="How reports work">
		<div class="wrap">
			<Descent />
			<div class="grid">
				<div class="stack">
					{#each REPORTS_PAGE.paragraphs as paragraph (paragraph)}
						<p><RichText text={paragraph} /></p>
					{/each}
				</div>
				<PosterFigure />
			</div>
		</div>
	</section>

	<section class="reports" aria-labelledby="reports-title">
		<div class="wrap">
			<h2 id="reports-title">What there is to read</h2>
			<div class="shelves">
				{#snippet shelf(group: (typeof REPORT_GROUPS)[number])}
					<div class="shelf">
						<h3>{group.title}</h3>
						<dl>
							{#each group.reports as report (report.name)}
								<div>
									<dt>{report.name}</dt>
									<dd>{report.text}</dd>
								</div>
							{/each}
						</dl>
					</div>
				{/snippet}
				{@render shelf(aboutPerson)}
				<div class="side">
					{#each others as group (group.title)}
						{@render shelf(group)}
					{/each}
				</div>
			</div>
		</div>
	</section>

	<section class="printing" aria-labelledby="printing-title">
		<div class="wrap">
			<h2 id="printing-title">Printing</h2>
			<dl class="ledger">
				{#each PRINTING as item (item.name)}
					<div>
						<dt>{item.name}</dt>
						<dd>{item.text}</dd>
					</div>
				{/each}
			</dl>
		</div>
	</section>
</main>

<SiteFooter
	title={REPORTS_PAGE.closeTitle}
	actionLabel={REPORTS_PAGE.closeAction}
	actionHref={DEMO_REPORTS_URL}
/>

<style>
	.wrap {
		max-width: var(--measure);
		margin: 0 auto;
		padding: 0 var(--gutter) var(--section-gap);
	}

	.grid {
		display: grid;
		grid-template-columns: minmax(0, 4fr) minmax(0, 7fr);
		gap: clamp(32px, 5vw, 64px);
		align-items: start;
	}

	/* Level with the top of the printed sheet rather than the figure's frame. */
	.stack {
		padding-top: 16px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.stack p {
		margin: 0;
		color: var(--stone-strong);
		max-width: 62ch;
	}

	h2 {
		margin: 0 0 clamp(24px, 3vw, 32px);
		font-size: var(--site-h2);
		line-height: 1.15;
		letter-spacing: -0.015em;
	}

	/* The reports: the person's shelf is the long one, so the partnership and the whole tree share
	the other column and the two end level. */
	.reports .wrap {
		padding-top: 0;
	}

	.shelves {
		display: grid;
		grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
		gap: clamp(32px, 5vw, 64px);
		align-items: start;
	}

	.side {
		display: flex;
		flex-direction: column;
		gap: clamp(32px, 4vw, 44px);
	}

	h3 {
		margin: 0 0 4px;
		font-size: var(--site-h3);
		line-height: 1.3;
	}

	dl {
		margin: 0;
	}

	.shelf dl > div {
		position: relative;
		padding: 12px 0 12px 22px;
		border-bottom: 1px solid var(--stone-rule);
	}

	/* The mark's partner disc, as the home page's feature lists use it. */
	.shelf dl > div::before {
		content: '';
		position: absolute;
		left: 2px;
		top: calc(12px + 0.6em);
		width: 7px;
		height: 7px;
		border-radius: 9999px;
		background: var(--emerald-800);
	}

	dt {
		font-weight: 600;
		color: var(--stone-ink);
	}

	dd {
		margin: 2px 0 0;
		font-size: var(--site-small);
		line-height: 1.5;
		color: var(--stone-text);
	}

	/* Printing stays on the paper, so the close is the page's one emerald ground. */
	.printing {
		border-top: 1px solid var(--stone-rule);
	}

	.printing .wrap {
		padding-top: var(--section-gap);
	}

	.ledger {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0 clamp(32px, 5vw, 64px);
	}

	.ledger > div {
		padding: 18px 0 20px;
		border-top: 1px solid var(--stone-rule);
	}

	.ledger dt {
		font-size: var(--site-h4);
	}

	.ledger dd {
		margin-top: 6px;
		max-width: 52ch;
	}

	@media (max-width: 860px) {
		.grid,
		.shelves,
		.ledger {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
