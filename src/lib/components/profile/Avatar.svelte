<script lang="ts">
	import { initialsOf } from '#lib/shared/profile.js';

	interface Props {
		/** Display name; its first two words give the initials. */
		name: string | null;
		email: string;
		/** Where the picture is served; null, or a picture that fails to load, shows initials. */
		src: string | null;
		/** `lg` is for the profile page, `sm` for the header. */
		size?: 'sm' | 'lg';
	}

	let { name, email, src, size = 'sm' }: Props = $props();

	// Remembers which address failed, so a new address gets a fresh try without an effect to reset it.
	// A picture that fails to load (removed, revoked, offline) must not leave a broken-image icon.
	let failedSrc = $state<string | null>(null);

	const label = $derived(`Picture of ${name?.trim() || email}`);
	const sizeClass = $derived(size === 'lg' ? 'h-20 w-20 text-2xl' : 'h-8 w-8 text-xs');
</script>

{#if src && failedSrc !== src}
	<img
		{src}
		alt={label}
		onerror={() => (failedSrc = src)}
		class="{sizeClass} shrink-0 rounded-full bg-stone-200 object-cover"
	/>
{:else}
	<span
		role="img"
		aria-label={label}
		class="{sizeClass} inline-flex shrink-0 items-center justify-center rounded-full bg-emerald-800 font-bold text-amber-50 select-none"
	>
		{initialsOf(name, email)}
	</span>
{/if}
