<script lang="ts">
	/** Numbered pages for a list whose size is known; the lists without it keep Previous and Next. */
	interface NumberedPages {
		/** 1-based. */
		current: number;
		count: number;
		hrefFor: (page: number) => string;
	}

	interface Props {
		/** Address of the previous page, or null on the first. */
		previousHref: string | null;
		/** Address of the next page, or null on the last. */
		nextHref: string | null;
		/** Describes the page for people using a screen reader, e.g. "Showing 51 to 100". */
		summary: string;
		/** When given, the pager also offers First, Last and a window of page numbers. */
		pages?: NumberedPages;
	}

	let { previousHref, nextHref, summary, pages }: Props = $props();

	/** Page numbers around the current one, with the ends kept and `null` standing for a gap: 1 … 4 5 [6] 7 8 … 20. */
	function windowOf(current: number, count: number): Array<number | null> {
		const shown = new Set([1, count]);
		for (let n = current - 2; n <= current + 2; n++) if (n >= 1 && n <= count) shown.add(n);
		const sorted = [...shown].sort((a, b) => a - b);
		return sorted.flatMap((n, i) => (i > 0 && n - sorted[i - 1]! > 1 ? [null, n] : [n]));
	}

	const buttonClass = 'action-btn focus-ring coarse:min-h-11';
</script>

{#snippet step(label: string, href: string | null, rel?: string)}
	{#if href}
		<a {href} {rel} class={buttonClass}>{label}</a>
	{:else}
		<span class="{buttonClass} opacity-40" aria-disabled="true">{label}</span>
	{/if}
{/snippet}

<nav class="flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="Pages">
	<span class="text-stone-600" aria-live="polite">{summary}</span>
	<span class="flex flex-wrap gap-2 print:hidden">
		{#if pages}
			{@render step('First', pages.current > 1 ? pages.hrefFor(1) : null)}
		{/if}
		{@render step('Previous', previousHref, 'prev')}
		{#if pages}
			{#each windowOf(pages.current, pages.count) as n, i (n ?? `gap${i}`)}
				{#if n === null}
					<span class="px-1 py-1.5 text-stone-500" aria-hidden="true">…</span>
				{:else if n === pages.current}
					<span class="{buttonClass} bg-emerald-800 text-white" aria-current="page">{n}</span>
				{:else}
					<a href={pages.hrefFor(n)} class={buttonClass} aria-label={`Page ${n}`}>{n}</a>
				{/if}
			{/each}
		{/if}
		{@render step('Next', nextHref, 'next')}
		{#if pages}
			{@render step('Last', pages.current < pages.count ? pages.hrefFor(pages.count) : null)}
		{/if}
	</span>
</nav>
