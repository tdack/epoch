<script lang="ts" module>
	/** Shown on the splash and reused as the welcome page's meta description. */
	export const SPLASH_TAGLINE =
		'A private family history, shared with the people who help keep it.';
</script>

<script lang="ts">
	import EpochMark from './EpochMark.svelte';

	interface Props {
		/** Text of the one button. */
		actionLabel: string;
		/** Where the button goes. A full navigation, so an Access-protected path works. */
		actionHref: string;
		/** A line under the button: an invitation note, or why the visitor is seeing this page. */
		message?: string;
	}

	let { actionLabel, actionHref, message }: Props = $props();
</script>

<!-- The photograph is decoration, so it lives in CSS rather than an <img> a screen reader would
announce. The emerald wash keeps the cream text above contrast over the brightest spines. -->
<main
	class="relative isolate flex min-h-dvh items-center justify-center overflow-hidden bg-emerald-900 bg-cover bg-center px-6 py-16 text-amber-50"
	style="background-image: image-set(url('/brand/splash-library.webp') type('image/webp'), url('/brand/splash-library.jpg') type('image/jpeg'))"
>
	<div
		aria-hidden="true"
		class="absolute inset-0 -z-10 bg-linear-to-br from-emerald-950/90 via-emerald-900/80 to-emerald-950/70"
	></div>
	<div
		class="flex w-full max-w-4xl flex-col items-center gap-10 text-center md:flex-row md:gap-14 md:text-left"
	>
		<EpochMark
			size={240}
			ink="#fffbeb"
			ancestryOpacity={0.4}
			class="h-40 w-40 shrink-0 md:h-60 md:w-60"
		/>
		<div class="flex flex-col items-center gap-6 md:items-start">
			<h1 class="text-6xl font-bold tracking-tight sm:text-7xl md:text-8xl">Epoch</h1>
			<p class="max-w-xl text-xl leading-snug text-emerald-200 sm:text-2xl">{SPLASH_TAGLINE}</p>
			<a
				href={actionHref}
				class="mt-2 inline-flex min-h-12 items-center rounded-xl bg-amber-50 px-7 text-base font-semibold text-emerald-900 shadow-lg shadow-emerald-950/30 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
			>
				{actionLabel}
			</a>
			{#if message}
				<p class="text-sm text-emerald-100">{message}</p>
			{/if}
		</div>
	</div>
</main>
