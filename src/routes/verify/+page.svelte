<script lang="ts">
	import Splash from '#lib/components/brand/Splash.svelte';

	let { data, form } = $props();
</script>

<svelte:head>
	<title>Epoch</title>
	<meta name="robots" content="noindex" />
	<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</svelte:head>

<Splash
	actionLabel="Sign in instead"
	actionHref={data.signInHref}
	sourceUrl={data.sourceUrl}
	sourceCommit={data.sourceCommit}
	message={form?.failed ? 'That check did not go through. Please try again.' : undefined}
>
	<form method="POST" class="flex flex-col items-center gap-4 md:items-start">
		<p class="text-emerald-100">Confirm you are a person to read this family tree.</p>
		<input type="hidden" name="next" value={data.next} />
		<div class="cf-turnstile" data-sitekey={data.siteKey} data-action={data.action}></div>
		<button
			type="submit"
			class="inline-flex min-h-12 items-center rounded-xl bg-amber-50 px-7 text-base font-semibold text-emerald-900 shadow-lg shadow-emerald-950/30 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
		>
			Continue
		</button>
	</form>
</Splash>
