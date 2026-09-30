<script lang="ts">
	import { page } from '$app/state';

	interface Props {
		/** The tree these links belong to. */
		treeId: string;
	}

	let { treeId }: Props = $props();

	const base = $derived(`/trees/${encodeURIComponent(treeId)}`);
	const links = $derived([
		{ href: base, label: 'Tree', isActive: page.url.pathname === base },
		{ href: `${base}/search`, label: 'Search', isActive: page.url.pathname.startsWith(`${base}/search`) },
		{ href: `${base}/people`, label: 'People', isActive: page.url.pathname === `${base}/people` },
		{ href: `${base}/unions`, label: 'Partnerships', isActive: page.url.pathname === `${base}/unions` },
		{ href: `${base}/surnames`, label: 'Surnames', isActive: page.url.pathname.startsWith(`${base}/surnames`) }
	]);
</script>

<nav aria-label="Tree sections" class="flex flex-wrap gap-1 text-sm">
	{#each links as link (link.href)}
		<a
			href={link.href}
			aria-current={link.isActive ? 'page' : undefined}
			class="rounded-lg px-3 py-1.5 font-semibold {link.isActive ? 'bg-emerald-800 text-white' : 'text-stone-700 hover:bg-stone-200'}"
		>
			{link.label}
		</a>
	{/each}
</nav>
