<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** The way back, outermost first; paper has no use for it. */
		crumbs: Array<{ label: string; href: string }>;
		title: string;
		/** One line under the title saying what the report covers; it prints. */
		summary?: Snippet;
		/** The report's controls and downloads; they never print. */
		actions?: Snippet;
	}

	let { crumbs, title, summary, actions }: Props = $props();
</script>

<nav aria-label="Breadcrumb" class="text-xs text-stone-600 print:hidden">
	{#each crumbs as crumb, i (crumb.href)}
		{#if i > 0}<span aria-hidden="true" class="mx-1">›</span>{/if}<a
			href={crumb.href}
			class="text-link">{crumb.label}</a
		>
	{/each}
</nav>
<header
	class="mt-1 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-stone-200 pb-4 print:mt-0 print:border-stone-400 print:pb-2"
>
	<div class="max-w-2xl min-w-0">
		<h1 class="text-2xl font-bold text-balance text-stone-900">{title}</h1>
		{#if summary}
			<p class="mt-1 text-sm text-pretty text-stone-600">{@render summary()}</p>
		{/if}
	</div>
	{#if actions}
		<div class="flex flex-wrap items-center gap-3 text-sm print:hidden">{@render actions()}</div>
	{/if}
</header>
