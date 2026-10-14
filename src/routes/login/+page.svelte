<script lang="ts">
	import Splash from '#lib/components/brand/Splash.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Sign in · Epoch</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<Splash
	actionLabel="Back to the welcome page"
	sourceUrl={data.sourceUrl}
	sourceCommit={data.sourceCommit}
	actionHref={data.welcomePath}
	message="We could not confirm your sign-in. Try again from the welcome page, and if it keeps happening, ask whoever invited you."
/>
