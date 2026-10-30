<script lang="ts">
	import EpochMark from '#lib/components/brand/EpochMark.svelte';

	let { data, form } = $props();
</script>

<svelte:head>
	<title>Finish setting up · Epoch</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="min-h-dvh bg-stone-50 px-4 py-12 text-stone-800">
	<div class="mx-auto flex max-w-xl flex-col gap-8">
		<header class="flex items-center gap-4">
			<EpochMark size={56} class="h-14 w-14 shrink-0" />
			<div>
				<h1 class="text-2xl font-bold tracking-tight text-emerald-900">Finish setting up Epoch</h1>
				<p class="text-sm text-stone-600">{data.address}</p>
			</div>
		</header>

		{#if form?.isDone}
			<section class="flex flex-col gap-4 rounded-xl border border-emerald-200 bg-white p-6">
				<h2 class="text-lg font-semibold text-emerald-900">Epoch is ready</h2>
				<p>
					Cloudflare Access now guards sign-in on the account “{form.accountName}”, and you are
					recorded as the install owner. This page is closed for good.
				</p>
				{#if form.isAppForeign}
					<p>
						An Access application already covered this address's sign-in page, so it was used as it
						is. If you cannot sign in, check its policy admits your address.
					</p>
				{:else}
					<p>
						Access admits {form.ownerEmail} through the policy “{form.policyName}”. To let someone
						else sign in, invite them from a tree's Members page and add their address to that
						policy in Zero Trust.
					</p>
				{/if}
				<p class="font-semibold">
					Delete the API token now, under My Profile → API Tokens or Manage Account → Account API
					Tokens. Epoch did not keep it.
				</p>
				<a
					href={form.loginHref}
					class="self-start rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-amber-50 hover:bg-emerald-700"
				>
					Sign in
				</a>
			</section>
		{:else}
			<section class="flex flex-col gap-3">
				<p>
					Epoch is deployed. Before anyone can sign in, it needs Cloudflare Access in front of its
					sign-in page and an owner. This page does both, once, and then closes.
				</p>
				<ol class="flex list-decimal flex-col gap-2 pl-5">
					<li>
						In the Cloudflare dashboard, open <strong>Zero Trust</strong> and make sure it has a login
						method under Settings → Authentication. One-time PIN, which emails a code, is the simplest.
					</li>
					<li>
						<a
							href={data.tokenTemplateUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="font-semibold text-emerald-800 underline">Create an account API token</a
						>
						on the account Epoch was deployed to. The link chooses its permissions: Access: Apps and Policies
						(edit), Access: Organizations, Identity Providers, and Groups (read), and Workers Scripts
						(read).
					</li>
					<li>Paste it below with the address you will sign in with.</li>
				</ol>
				<p class="text-sm text-stone-600">
					The token is used for this one request and never stored. Only a token for the account that
					serves this address is accepted.
				</p>
			</section>

			<form
				method="POST"
				class="flex flex-col gap-4 rounded-xl border border-stone-200 bg-white p-6"
			>
				<div>
					<label for="setup-owner-email" class="field-label">Your email address</label>
					<input
						id="setup-owner-email"
						name="ownerEmail"
						type="email"
						required
						autocomplete="email"
						value={form?.ownerEmail ?? ''}
						class="field-input"
					/>
				</div>
				<div>
					<label for="setup-token" class="field-label">API token</label>
					<input
						id="setup-token"
						name="token"
						type="password"
						required
						autocomplete="off"
						spellcheck="false"
						class="field-input"
					/>
				</div>
				{#if form?.message}
					<p role="alert" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
						{form.message}
					</p>
				{/if}
				<button
					type="submit"
					class="self-start rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-amber-50 hover:bg-emerald-700"
				>
					Set up Epoch
				</button>
			</form>
		{/if}
	</div>
</main>
