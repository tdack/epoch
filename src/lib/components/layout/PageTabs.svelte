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
			class="shrink-0 border-b-2 px-3 py-2 font-semibold whitespace-nowrap focus-ring-inset coarse:inline-flex coarse:min-h-11 coarse:items-center {tab.isCurrent
				? 'border-emerald-800 text-emerald-900'
				: 'border-transparent text-stone-600 hover:text-stone-900'}"
		>
			{tab.label}
		</a>
	{/each}
</nav>
