<script lang="ts">
	import Splash, { SPLASH_TAGLINE as description } from '#lib/components/brand/Splash.svelte';

	let { data } = $props();

	const actionLabels = {
		'signed-in': 'Continue to your trees',
		'signed-out': 'Sign in',
		'not-invited': 'Sign out'
	} as const;
	const message = $derived(
		data.state === 'signed-out'
			? 'Access is by invitation. Sign in with the address your invitation was sent to.'
			: data.state === 'not-invited'
				? `You are signed in as ${data.notAdmittedEmail}, which has no invitation here. Ask the owner for an invitation, or sign out and use the address it was sent to.`
				: undefined
	);
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
	actionLabel={actionLabels[data.state]}
	sourceUrl={data.sourceUrl}
	sourceCommit={data.sourceCommit}
	actionHref={data.actionHref}
	{message}
	explore={data.publicTree
		? { label: `Explore ${data.publicTree.name}`, href: data.publicTree.href }
		: undefined}
/>
