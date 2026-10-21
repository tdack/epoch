<script lang="ts">
	import { LogOut, Shield, User } from '@lucide/svelte';
	import Popover from '#lib/components/layout/Popover.svelte';
	import Avatar from '#lib/components/profile/Avatar.svelte';
	import type { ProfileViewDto } from '#lib/shared/profile.js';

	interface Props {
		viewer: ProfileViewDto;
		/** Profile, appearance and the person's trees (ADR-075). */
		accountHref: string;
		/** The install owner's page; absent for everyone else, so the item is not shown. */
		adminHref?: string;
		/** A Cloudflare Access path, not a route, so it is followed with a full page load. */
		signOutHref: string;
	}

	let { viewer, accountHref, adminHref, signOutHref }: Props = $props();

	const itemClass = 'menu-item flex items-center gap-2 px-3 py-2 text-xs font-medium';
</script>

<Popover label="Account" align="end" panelClass="w-56 py-1">
	{#snippet trigger(attrs)}
		<button
			type="button"
			{...attrs}
			aria-label="Account menu"
			class="cursor-pointer rounded-full focus-ring coarse:min-h-11 coarse:min-w-11"
		>
			<Avatar name={viewer.name} email={viewer.email} src={viewer.avatarUrl} />
		</button>
	{/snippet}
	<div class="border-b border-stone-200 px-3 py-2">
		<p class="truncate text-sm font-semibold text-stone-900">{viewer.name || viewer.email}</p>
		{#if viewer.name}
			<p class="truncate text-xs text-stone-600">{viewer.email}</p>
		{/if}
	</div>
	<div class="pt-1">
		<a href={accountHref} role="menuitem" class={itemClass}>
			<User class="h-3.5 w-3.5" aria-hidden="true" />
			Account
		</a>
		{#if adminHref}
			<a href={adminHref} role="menuitem" class={itemClass}>
				<Shield class="h-3.5 w-3.5" aria-hidden="true" />
				Administration
			</a>
		{/if}
		<!-- The reload keeps the client router from answering the Cloudflare path with a 404. -->
		<a href={signOutHref} role="menuitem" data-sveltekit-reload class={itemClass}>
			<LogOut class="h-3.5 w-3.5" aria-hidden="true" />
			Sign out
		</a>
	</div>
</Popover>
