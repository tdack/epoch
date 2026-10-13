<script lang="ts">
	const TONE_CLASSES = {
		light: 'text-stone-500 hover:text-stone-800',
		dark: 'text-emerald-200/80 hover:text-amber-50'
	} as const;

	interface Props {
		/** The repository holding the source this install runs; a fork's own, not necessarily upstream. */
		href: string;
		/** `light` on the cream app pages, `dark` over the splash photograph. */
		tone?: keyof typeof TONE_CLASSES;
	}

	let { href, tone = 'light' }: Props = $props();
</script>

<!-- AGPL section 13 asks that people using Epoch over a network be offered its source. -->
<a
	{href}
	class="rounded text-xs underline-offset-2 focus-ring hover:underline {TONE_CLASSES[tone]}"
>
	Source code (AGPL)
</a>
