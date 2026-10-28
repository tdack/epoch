<script lang="ts">
	import { page } from '$app/state';
	import EpochMark from './EpochMark.svelte';

	// The in-page links follow the home page's order and start with `/`, so they also work from the
	// pages below it. The pages of their own come last.
	const NAV = [
		{ href: '/#explore', label: 'Explore' },
		{ href: '/#features', label: 'Features' },
		{ href: '/#views', label: '3D Views' },
		{ href: '/#code', label: 'Get the code' },
		{ href: '/#install', label: 'Install' },
		{ href: '/#faq', label: 'FAQ' },
		{ href: '/reports', label: 'Reports' },
		{ href: '/maps', label: 'Maps' },
		{ href: '/sub-trees', label: 'Sub-trees' },
		{ href: '/roles', label: 'Roles' }
	];

	/** `page` marks the link to the page being read; a jump link to a section never is. */
	const current = (href: string) => (page.url.pathname === href ? 'page' : undefined);

	let scrollY = $state(0);
	let menu = $state<HTMLDetailsElement>();

	/** Clear over the hero's photograph; solid once the page moves, so text never shows through. */
	let isSolid = $derived(scrollY > 8);

	// A jump link leaves the menu open over the section it went to, so following one closes it.
	function closeMenu() {
		if (menu) menu.open = false;
	}
</script>

<svelte:window bind:scrollY />

<!-- Sticky over the whole page, it overlaps the hero by its own height rather than pushing it
down, so the photograph still runs to the top edge. -->
<div class="bar" class:is-solid={isSolid}>
	<nav aria-label="Main" class="nav">
		<a href="/#top" class="brand">
			<EpochMark size={30} ink="var(--vellum)" />
			<span>Epoch</span>
		</a>
		<ul class="links">
			{#each NAV as item (item.href)}
				<li>
					<a href={item.href} aria-current={current(item.href)}>{item.label}</a>
				</li>
			{/each}
		</ul>
		<details class="menu" bind:this={menu}>
			<summary>Menu</summary>
			<ul>
				{#each NAV as item (item.href)}
					<li>
						<a href={item.href} aria-current={current(item.href)} onclick={closeMenu}
							>{item.label}</a
						>
					</li>
				{/each}
			</ul>
		</details>
	</nav>
</div>

<style>
	.bar {
		position: sticky;
		top: 0;
		z-index: 20;
		height: var(--nav-height);
		margin-bottom: calc(-1 * var(--nav-height));
		color: var(--vellum);
		border-bottom: 1px solid transparent;
		transition:
			background-color 200ms var(--ease-out),
			border-color 200ms var(--ease-out),
			box-shadow 200ms var(--ease-out);
	}

	.bar.is-solid {
		background: rgb(2 44 34 / 0.94);
		border-bottom-color: rgb(110 231 183 / 0.18);
		box-shadow: 0 8px 24px rgb(2 44 34 / 0.25);
	}

	@supports (backdrop-filter: blur(1px)) {
		.bar.is-solid {
			background: rgb(2 44 34 / 0.86);
			backdrop-filter: blur(12px) saturate(1.2);
		}
	}

	.nav {
		max-width: var(--measure);
		height: 100%;
		margin: 0 auto;
		padding: 0 var(--gutter);
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
		font-size: var(--site-h4);
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
		font-size: var(--site-small);
		white-space: nowrap;
		text-decoration: none;
	}

	.links a[aria-current='page'],
	.menu a[aria-current='page'] {
		color: var(--vellum);
		background: rgb(255 251 235 / 0.12);
	}

	.links a:hover,
	.menu a:hover {
		color: var(--vellum);
		background: rgb(255 251 235 / 0.08);
	}

	.bar :focus-visible {
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

	/* Ten links on one line need about 1000px beside the brand; below that one would wrap. */
	@media (max-width: 1140px) {
		.links {
			display: none;
		}

		.menu {
			display: block;
		}
	}
</style>
