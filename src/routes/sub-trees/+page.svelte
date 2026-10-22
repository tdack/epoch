<script lang="ts">
	import Descent from '#lib/components/Descent.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import RichText from '#lib/components/RichText.svelte';
	import SiteFooter from '#lib/components/SiteFooter.svelte';
	import SubtreeFigure from '#lib/components/SubtreeFigure.svelte';
	import { DEMO_SUBTREE_URL, SITE_URL, SUBTREE_SCOPE, SUBTREES_PAGE } from '#lib/site.js';
</script>

<svelte:head>
	<title>{SUBTREES_PAGE.title} · Epoch</title>
	<meta name="description" content={SUBTREES_PAGE.description} />
	<link rel="canonical" href="{SITE_URL}{SUBTREES_PAGE.path}" />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Epoch" />
	<meta property="og:title" content="{SUBTREES_PAGE.title} · Epoch" />
	<meta property="og:description" content={SUBTREES_PAGE.description} />
	<meta property="og:url" content="{SITE_URL}{SUBTREES_PAGE.path}" />
	<meta property="og:image" content="{SITE_URL}/brand/og-image.png" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<PageHeader title={SUBTREES_PAGE.title} lede={SUBTREES_PAGE.lede} />

<main>
	<section class="subtrees" aria-label="What a sub-tree is">
		<div class="wrap">
			<Descent />

			<div class="grid">
				<div class="stack">
					{#each SUBTREES_PAGE.paragraphs as paragraph (paragraph)}
						<p><RichText text={paragraph} /></p>
					{/each}
				</div>
				<SubtreeFigure />
				<div class="scope">
					<div>
						<h2 class="label">Narrowed to the line</h2>
						<ul>
							{#each SUBTREE_SCOPE.narrowed as item (item)}
								<li>{item}</li>
							{/each}
						</ul>
					</div>
					<div>
						<h2 class="label">Still the whole tree</h2>
						<ul>
							{#each SUBTREE_SCOPE.whole as item (item)}
								<li>{item}</li>
							{/each}
						</ul>
					</div>
					<p class="note">{SUBTREES_PAGE.note}</p>
				</div>
			</div>
		</div>
	</section>
</main>

<SiteFooter
	title={SUBTREES_PAGE.closeTitle}
	actionLabel={SUBTREES_PAGE.closeAction}
	actionHref={DEMO_SUBTREE_URL}
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
		gap: clamp(32px, 5vw, 56px) clamp(32px, 5vw, 64px);
		align-items: center;
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: 18px;
		align-items: flex-start;
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
