<script lang="ts">
	import Descent from '#lib/components/Descent.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import RichText from '#lib/components/RichText.svelte';
	import SiteFooter from '#lib/components/SiteFooter.svelte';
	import { ROLES, ROLES_PAGE, SITE_URL } from '#lib/site.js';
</script>

<svelte:head>
	<title>{ROLES_PAGE.title} · Epoch</title>
	<meta name="description" content={ROLES_PAGE.description} />
	<link rel="canonical" href="{SITE_URL}{ROLES_PAGE.path}" />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Epoch" />
	<meta property="og:title" content="{ROLES_PAGE.title} · Epoch" />
	<meta property="og:description" content={ROLES_PAGE.description} />
	<meta property="og:url" content="{SITE_URL}{ROLES_PAGE.path}" />
	<meta property="og:image" content="{SITE_URL}/brand/og-image.png" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<PageHeader title={ROLES_PAGE.title} lede={ROLES_PAGE.lede} />

<main>
	<section class="roles" aria-label="The five roles, lowest first">
		<div class="wrap">
			<Descent />

			<ol class="ladder">
				{#each ROLES as role (role.name)}
					<li>
						<span class="rung" aria-hidden="true"></span>
						<div class="who">
							<h2>{role.name}</h2>
							<p>{role.summary}</p>
						</div>
						<div class="what">
							<ul>
								{#each role.adds as item (item)}
									<li><RichText text={item} /></li>
								{/each}
							</ul>
							{#if role.note}
								<p class="aside">{role.note}</p>
							{/if}
						</div>
					</li>
				{/each}
			</ol>
		</div>
	</section>
</main>

<SiteFooter />

<style>
	.wrap {
		max-width: var(--measure);
		margin: 0 auto;
		padding: 0 var(--gutter) var(--section-gap);
	}

	/* Roles: a ladder down the line of descent, each rung adding to the last. */
	.ladder {
		max-width: 1000px;
		margin: 0 auto;
		padding: 0;
		list-style: none;
	}

	.ladder > li {
		position: relative;
		display: grid;
		grid-template-columns: 18px minmax(0, 15rem) minmax(0, 1fr);
		gap: 8px clamp(20px, 3vw, 40px);
		padding: 22px 0;
	}

	/* The line runs from each rung's node to the next one's, so it stops at the owner. */
	.ladder > li:not(:last-child)::before {
		content: '';
		position: absolute;
		left: 7.5px;
		top: 38px;
		bottom: -38px;
		width: 3px;
		background: var(--emerald-800);
	}

	/* The rule between rungs starts after the line, so the line reads unbroken. */
	.ladder > li + li::after {
		content: '';
		position: absolute;
		top: 0;
		left: calc(18px + clamp(20px, 3vw, 40px));
		right: 0;
		border-top: 1px solid var(--stone-rule);
	}

	.rung {
		position: relative;
		margin-top: 7px;
		width: 18px;
		height: 18px;
		border-radius: 9999px;
		background: var(--emerald-800);
	}

	.who h2 {
		margin: 0;
		font-size: var(--site-h3);
		line-height: 1.3;
	}

	.who p {
		margin: 2px 0 0;
		color: var(--stone-text);
	}

	.what ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.what li {
		position: relative;
		padding: 3px 0 3px 20px;
		color: var(--stone-strong);
		line-height: 1.5;
	}

	.what li::before {
		content: '';
		position: absolute;
		left: 2px;
		top: 0.82em;
		width: 7px;
		height: 7px;
		border-radius: 9999px;
		background: var(--emerald-800);
	}

	.what .aside {
		margin: 8px 0 0;
		padding-left: 20px;
		font-size: var(--site-small);
		color: var(--stone-text);
		font-style: italic;
	}

	@media (max-width: 860px) {
		.ladder > li {
			grid-template-columns: 18px minmax(0, 1fr);
		}

		.what {
			grid-column: 2;
		}
	}
</style>
