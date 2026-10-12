<script lang="ts">
	import EpochMark from './EpochMark.svelte';
	import { DEMO_URL, REPO_URL, TAGLINE } from '#lib/site.js';

	const NAV = [
		{ href: '#features', label: 'Features' },
		{ href: '#code', label: 'Get the code' },
		{ href: '#install', label: 'Install' },
		{ href: '#faq', label: 'FAQ' }
	];
</script>

<!-- The photograph is decoration, as on the app's splash, so it lives in CSS. The emerald wash
keeps vellum text above contrast over the brightest spines. -->
<header class="hero" id="top">
	<nav aria-label="Main" class="nav">
		<a href="#top" class="brand">
			<EpochMark size={30} ink="var(--vellum)" />
			<span>Epoch</span>
		</a>
		<ul class="links">
			{#each NAV as item (item.href)}
				<li><a href={item.href}>{item.label}</a></li>
			{/each}
			<li><a href={REPO_URL}>GitHub</a></li>
		</ul>
		<details class="menu">
			<summary>Menu</summary>
			<ul>
				{#each NAV as item (item.href)}
					<li><a href={item.href}>{item.label}</a></li>
				{/each}
				<li><a href={REPO_URL}>GitHub</a></li>
			</ul>
		</details>
	</nav>

	<!-- The Epoch mark at the scale of the page: the faded generation before, the partners and
	their union, and the amber child, which is the action. -->
	<div class="tree">
		<span class="ancestor left" aria-hidden="true"></span>
		<span class="ancestor right" aria-hidden="true"></span>

		<div class="title">
			<h1>Epoch</h1>
			<p class="tagline">{TAGLINE}</p>
		</div>

		<div class="union" aria-hidden="true">
			<span class="partner left"></span>
			<span class="rule"></span>
			<span class="partner right"></span>
		</div>

		<div class="child">
			<span class="stem" aria-hidden="true"></span>
			<a class="cta" href={DEMO_URL}>
				Explore the demo tree
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.4"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg
				>
			</a>
			<a class="secondary" href="#install">or install it on your own Cloudflare account</a>
		</div>
	</div>
</header>

<style>
	.hero {
		position: relative;
		isolation: isolate;
		overflow: clip;
		color: var(--vellum);
		background-color: var(--emerald-900);
		background-image: image-set(
			url('/brand/splash-library.webp') type('image/webp'),
			url('/brand/splash-library.jpg') type('image/jpeg')
		);
		background-size: cover;
		background-position: center;
	}

	.hero::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background: linear-gradient(
			160deg,
			rgb(2 44 34 / 0.94) 0%,
			rgb(6 78 59 / 0.84) 55%,
			rgb(2 44 34 / 0.92) 100%
		);
	}

	.nav {
		max-width: var(--measure);
		margin: 0 auto;
		padding: 18px var(--gutter);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		color: var(--vellum);
		font-weight: 700;
		font-size: 1.125rem;
		text-decoration: none;
	}

	.links,
	.menu ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.links {
		display: flex;
		gap: 8px;
	}

	.links a,
	.menu a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 12px;
		border-radius: 8px;
		color: var(--emerald-100);
		font-weight: 600;
		font-size: 0.9375rem;
		text-decoration: none;
	}

	.links a:hover,
	.menu a:hover {
		color: var(--vellum);
		background: rgb(255 251 235 / 0.08);
	}

	.hero :focus-visible {
		outline-color: var(--amber-300);
		outline-offset: 4px;
	}

	.menu {
		display: none;
		position: relative;
	}

	.menu summary {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 16px;
		border: 1px solid rgb(255 251 235 / 0.6);
		border-radius: 12px;
		font-weight: 600;
		cursor: pointer;
		list-style: none;
	}

	.menu summary::-webkit-details-marker {
		display: none;
	}

	.menu ul {
		position: absolute;
		right: 0;
		top: calc(100% + 8px);
		z-index: 2;
		min-width: 200px;
		padding: 8px;
		border-radius: 12px;
		background: var(--emerald-950);
		border: 1px solid rgb(110 231 183 / 0.25);
		box-shadow: 0 16px 40px rgb(2 44 34 / 0.5);
	}

	.menu a {
		display: flex;
	}

	/* --side is the width of each partner's column; the ancestor line, the partner and the union's
	ends all sit on its centre, so the mark keeps its geometry at any width. */
	.tree {
		--side: clamp(56px, 17vw, 220px);
		--disc: clamp(30px, 7.5vw, 104px);
		--ink-weight: clamp(4px, 0.75vw, 10px);
		position: relative;
		max-width: var(--measure);
		margin: 0 auto;
		padding: clamp(24px, 6vw, 56px) var(--gutter) clamp(56px, 8vw, 96px);
		display: grid;
		grid-template-columns: var(--side) minmax(0, 1fr) var(--side);
	}

	/* Each ancestor is a grid item in its partner's column, so its line ends exactly where the
	partner disc begins, whatever height the title takes. */
	.ancestor {
		grid-row: 1;
		justify-self: center;
		position: relative;
		width: 86%;
		margin-top: clamp(8px, 2vw, 24px);
		pointer-events: none;
		opacity: 0.42;
	}

	.ancestor.left {
		grid-column: 1;
	}

	.ancestor.right {
		grid-column: 3;
	}

	.ancestor::before,
	.ancestor::after {
		content: '';
		position: absolute;
		background: var(--vellum);
		border-radius: 9999px;
	}

	.ancestor::before {
		left: 0;
		right: 0;
		top: 0;
		height: calc(var(--ink-weight) * 0.85);
	}

	.ancestor::after {
		left: 50%;
		top: 0;
		bottom: 0;
		width: calc(var(--ink-weight) * 0.85);
		translate: -50% 0;
	}

	.title {
		grid-column: 2;
		grid-row: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: clamp(14px, 2vw, 22px);
		padding: clamp(20px, 5vw, 64px) clamp(0px, 2vw, 24px) clamp(36px, 6vw, 72px);
		text-align: center;
	}

	h1 {
		margin: 0;
		color: var(--vellum);
		font-size: clamp(3.5rem, 9vw, 6rem);
		line-height: 1;
		letter-spacing: -0.025em;
		font-weight: 700;
	}

	.tagline {
		margin: 0;
		max-width: 24ch;
		color: var(--emerald-200);
		font-size: clamp(1.125rem, 2.2vw, 1.5rem);
		line-height: 1.35;
	}

	.union {
		grid-column: 1 / -1;
		grid-row: 2;
		position: relative;
		display: grid;
		grid-template-columns: var(--side) minmax(0, 1fr) var(--side);
		align-items: center;
		height: var(--disc);
	}

	.partner {
		justify-self: center;
		width: var(--disc);
		height: var(--disc);
		border-radius: 9999px;
		background: var(--vellum);
	}

	.partner.right {
		grid-column: 3;
	}

	.rule {
		position: absolute;
		left: calc(var(--side) / 2);
		right: calc(var(--side) / 2);
		top: 50%;
		height: var(--ink-weight);
		translate: 0 -50%;
		background: var(--vellum);
		border-radius: 9999px;
		z-index: -1;
	}

	.child {
		grid-column: 1 / -1;
		grid-row: 3;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		margin-top: calc(var(--disc) / -2);
	}

	.stem {
		width: var(--ink-weight);
		height: clamp(72px, 10vw, 120px);
		background: var(--vellum);
		border-radius: 9999px;
		transform-origin: top;
	}

	.cta {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-height: 64px;
		padding: 0 clamp(24px, 3vw, 34px);
		border-radius: 9999px;
		background: var(--amber);
		color: var(--emerald-950);
		font-weight: 700;
		font-size: clamp(1.0625rem, 1.6vw, 1.1875rem);
		text-decoration: none;
		box-shadow: 0 10px 30px rgb(2 44 34 / 0.45);
		transition:
			background-color 160ms var(--ease-out),
			box-shadow 160ms var(--ease-out),
			translate 160ms var(--ease-out);
	}

	.cta:hover {
		color: var(--emerald-950);
		background: var(--amber-300);
		translate: 0 -1px;
		box-shadow: 0 14px 36px rgb(2 44 34 / 0.5);
	}

	.cta svg {
		transition: translate 160ms var(--ease-out);
	}

	.cta:hover svg {
		translate: 3px 0;
	}

	.secondary {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		color: var(--emerald-100);
		font-weight: 600;
		font-size: 0.9375rem;
		text-align: center;
	}

	.secondary:hover {
		color: var(--vellum);
	}

	/* The one authored moment: on arrival the generation before fades in, the partners join and
	the stem drops to the action. Everything is visible by default and only animates from there. */
	@media (prefers-reduced-motion: no-preference) {
		.ancestor {
			animation: fade-in 900ms var(--ease-out) 100ms both;
		}

		.partner {
			animation: seat 700ms var(--ease-out) 250ms both;
		}

		.rule {
			animation: join 800ms var(--ease-out) 450ms both;
		}

		.stem {
			animation: drop 700ms var(--ease-out) 900ms both;
		}

		.cta {
			animation: seat 700ms var(--ease-out) 1250ms both;
		}
	}

	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}

	@keyframes seat {
		from {
			scale: 0.6;
			opacity: 0;
		}
	}

	@keyframes join {
		from {
			clip-path: inset(0 50% 0 50%);
		}
		to {
			clip-path: inset(0 0 0 0);
		}
	}

	@keyframes drop {
		from {
			scale: 1 0;
		}
	}

	@media (max-width: 760px) {
		.links {
			display: none;
		}

		.menu {
			display: block;
		}
	}
</style>
