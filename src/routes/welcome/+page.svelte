<script lang="ts">
	import Splash, { SPLASH_TAGLINE as description } from '#lib/components/brand/Splash.svelte';

	let { data } = $props();
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

<Splash
	actionLabel={data.isSignedIn ? 'Continue to your trees' : 'Sign in'}
	actionHref={data.actionHref}
	message={data.isSignedIn
		? undefined
		: 'Access is by invitation. Sign in with the address your invitation was sent to.'}
/>
