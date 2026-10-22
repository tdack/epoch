<script lang="ts">
	import Descent from './Descent.svelte';
	import EpochMark from './EpochMark.svelte';
	import { DEMO_URL, REPO_URL } from '#lib/site.js';

	interface Props {
		/** The closing statement above the action. */
		title?: string;
		/** The label of the one action. */
		actionLabel?: string;
		/** Where the action goes. */
		actionHref?: string;
	}

	let {
		title = 'Start with someone else’s tree.',
		actionLabel = 'Explore the demo tree',
		actionHref = DEMO_URL
	}: Props = $props();
</script>

<!-- Close: the line arrives at the amber child, the one action. -->
<footer class="close">
	<div class="wrap">
		<Descent tone="vellum" isFocus />
		<p class="close-title">{title}</p>
		<a class="button action large" href={actionHref}>{actionLabel}</a>
		<div class="colophon">
			<a href="/#top" class="mark-link">
				<EpochMark size={28} ink="var(--vellum)" />
				<span>Epoch</span>
			</a>
			<p>Inspired by the capabilities of webtrees, not its screens or code.</p>
			<ul>
				<li><a href={REPO_URL}>GitHub</a></li>
				<li><a href={DEMO_URL}>Demo</a></li>
				<li><a href="/#install">Install</a></li>
				<li><a href="/roles">Roles</a></li>
				<li><a href="/sub-trees">Sub-trees</a></li>
			</ul>
		</div>
	</div>
</footer>

<style>
	.close {
		background: var(--emerald-900);
		color: var(--vellum);
	}

	.wrap {
		max-width: var(--measure);
		margin: 0 auto;
		padding: 0 var(--gutter) 40px;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 24px;
	}

	.close-title {
		margin: 0;
		font-size: var(--site-h2);
		font-weight: 700;
		line-height: 1.15;
		letter-spacing: -0.015em;
	}

	/* The closing action is the page's last, so it is larger than the others; the amber pill itself
	   is the shared .button.action in app.css. */
	.button.large {
		min-height: 56px;
		padding: 0 28px;
		font-size: var(--site-h4);
	}

	.close :focus-visible {
		outline-color: var(--amber-300);
		outline-offset: 4px;
	}

	.colophon {
		width: 100%;
		margin-top: clamp(56px, 7vw, 88px);
		padding-top: 24px;
		border-top: 1px solid var(--emerald-mist-20);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px 24px;
		font-size: var(--site-small);
		color: var(--emerald-200);
	}

	.colophon p {
		margin: 0;
	}

	.colophon ul {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.colophon a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 10px;
		color: var(--emerald-100);
	}

	.colophon a:hover {
		color: var(--vellum);
	}

	.colophon .mark-link {
		gap: 10px;
		padding: 0;
		font-weight: 700;
		text-decoration: none;
		color: var(--vellum);
	}

	@media (max-width: 560px) {
		.colophon {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
