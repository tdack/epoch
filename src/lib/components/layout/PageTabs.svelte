<script lang="ts" module>
	// Why module state: a tab that leads to another page unmounts this nav with the old page, so the
	// link the keyboard user pressed no longer exists; the next page's nav picks the same one up.
	let hrefToRefocus: string | null = null;
</script>

<script lang="ts">
	interface Tab {
		href: string;
		label: string;
		isCurrent: boolean;
	}

	interface Props {
		/** What the tabs move between, named for screen readers ("Account", "Tree administration"). */
		label: string;
		tabs: Tab[];
	}

	let { label, tabs }: Props = $props();
</script>

<!-- Links rather than an ARIA tablist: each tab is an address, so it can be bookmarked and shared. -->
<!-- The rule is an inset shadow, not a border the tabs overlap with a negative margin: that overlap
     would overflow the scrolling row and show a scrollbar beside the tabs. -->
<nav
	aria-label={label}
	class="mb-6 flex gap-1 overflow-x-auto text-sm shadow-[inset_0_-1px_0_var(--color-stone-200)]"
>
	{#each tabs as tab (tab.href)}
		<a
			href={tab.href}
			aria-current={tab.isCurrent ? 'page' : undefined}
			data-sveltekit-reset="false"
			onclick={() =>
				// A tab on this same page (`#export`, `settings#export`) keeps its nav, so only another page needs it.
				(hrefToRefocus =
					new URL(tab.href, location.href).pathname === location.pathname ? null : tab.href)}
			{@attach (link) => {
				if (hrefToRefocus !== tab.href) return;
				hrefToRefocus = null;
				link.focus({ preventScroll: true });
			}}
			class="shrink-0 border-b-2 px-3 py-2 font-semibold whitespace-nowrap focus-ring-inset coarse:inline-flex coarse:min-h-11 coarse:items-center {tab.isCurrent
				? 'border-emerald-800 text-emerald-900'
				: 'border-transparent text-stone-600 hover:text-stone-900'}"
		>
			{tab.label}
		</a>
	{/each}
</nav>
