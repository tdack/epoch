<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Stable across people: it names the heading and the drawer's remembered open state. */
		id: string;
		title: string;
		layout: 'drawer' | 'page';
		/** The drawer's `<details>` start open; a stored choice for this section wins over it. */
		isOpenByDefault?: boolean;
		/** Set on the wrapper, for the tests that find a whole section. */
		testId?: string;
		children: Snippet;
	}

	let { id, title, layout, isOpenByDefault = false, testId, children }: Props = $props();

	const STORAGE_PREFIX = 'epoch.person-section.';

	/** Whether the drawer's `<details>` is open. Kept per section, not per person, so a choice follows the viewer around the tree. */
	let isOpen = $state(false);
	let hasRestored = false;
	$effect.pre(() => {
		if (hasRestored) return;
		hasRestored = true;
		isOpen = isOpenByDefault;
		try {
			const stored = localStorage.getItem(STORAGE_PREFIX + id);
			if (stored !== null) isOpen = stored === '1';
		} catch {
			// Remembering which sections are open is a convenience only.
		}
	});

	function toggled(event: Event) {
		isOpen = (event.currentTarget as HTMLDetailsElement).open;
		try {
			localStorage.setItem(STORAGE_PREFIX + id, isOpen ? '1' : '0');
		} catch {
			// As above.
		}
	}
</script>

{#if layout === 'drawer'}
	<details
		class="section-card"
		open={isOpen}
		ontoggle={toggled}
		data-testid={testId}
		data-section={id}
	>
		<summary class="cursor-pointer"
			><h3 id={`${id}-heading`} class="section-heading inline">{title}</h3></summary
		>
		<div class="mt-3 space-y-3">{@render children()}</div>
	</details>
{:else}
	<section
		aria-labelledby={`${id}-heading`}
		class="section-card"
		data-testid={testId}
		data-section={id}
	>
		<h3 id={`${id}-heading`} class="section-heading">{title}</h3>
		<div class="mt-3 space-y-3">{@render children()}</div>
	</section>
{/if}
