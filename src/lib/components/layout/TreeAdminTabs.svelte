<script lang="ts">
	interface Props {
		/** The tree's own path (`treePath`), without a sub-tree lens: both pages are about the whole tree. */
		base: string;
		/** The current path, so the page being shown reads as current. */
		pathname: string;
	}

	let { base, pathname }: Props = $props();

	// The gear in the tree switcher opens Settings; Members sits beside it so a tree's administration
	// is one place rather than two menu items (ADR-075).
	const tabs = $derived([
		{ href: `${base}/settings`, label: 'Settings' },
		{ href: `${base}/members`, label: 'Members' }
	]);
</script>

<nav aria-label="Tree administration" class="mb-6 flex gap-1 border-b border-stone-200 text-sm">
	{#each tabs as tab (tab.href)}
		{@const isCurrent = pathname.startsWith(tab.href)}
		<a
			href={tab.href}
			aria-current={isCurrent ? 'page' : undefined}
			class="-mb-px border-b-2 px-3 py-2 font-semibold focus-ring-inset coarse:inline-flex coarse:min-h-11 coarse:items-center {isCurrent
				? 'border-emerald-800 text-emerald-900'
				: 'border-transparent text-stone-600 hover:text-stone-900'}"
		>
			{tab.label}
		</a>
	{/each}
</nav>
