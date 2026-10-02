<script lang="ts">
	import EpochMark from '#lib/components/brand/EpochMark.svelte';

	let { data } = $props();

	const description = 'A private family history, shared with the people who help keep it.';
</script>

<svelte:head>
	<title>Epoch</title>
	<meta name="description" content={description} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Epoch" />
	<meta property="og:title" content="Epoch" />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={data.pageUrl} />
	<meta property="og:image" content={data.imageUrl} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content="The Epoch mark beside the words: {description}" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="theme-color" content="#064e3b" />
</svelte:head>

<main class="flex min-h-dvh items-center justify-center bg-emerald-900 px-6 py-16 text-amber-50">
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
			<p class="max-w-xl text-xl leading-snug text-emerald-200 sm:text-2xl">{description}</p>
			<!-- Every path but this one sits behind Cloudflare Access, so following any of them is what
           starts the sign-in; there is no login endpoint of Epoch's own. -->
			<a
				href="/"
				class="mt-2 inline-flex min-h-12 items-center rounded-xl bg-amber-50 px-7 text-base font-semibold text-emerald-900 shadow-lg shadow-emerald-950/30 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
			>
				{data.isSignedIn ? 'Continue to your trees' : 'Sign in'}
			</a>
			{#if !data.isSignedIn}
				<p class="text-sm text-emerald-100">
					Access is by invitation. Sign in with the address your invitation was sent to.
				</p>
			{/if}
		</div>
	</div>
</main>
