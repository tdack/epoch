<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Avatar from '#lib/components/profile/Avatar.svelte';
	import LeaveEpochDialog from '#lib/components/modals/LeaveEpochDialog.svelte';
	import {
		removeMyAvatar,
		saveMyName,
		uploadMyAvatar,
		useMyAccessPicture
	} from '#lib/api/profile.js';
	import { MAX_DISPLAY_NAME_LENGTH } from '#lib/shared/profile.js';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	const profile = $derived(data.profile);
	// Follows the stored name until the person types; reset once a save lands.
	let draft = $state<string | null>(null);
	const name = $derived(draft ?? profile.name ?? '');
	let isBusy = $state(false);
	let message = $state<{ text: string; isError: boolean } | null>(null);
	let isLeaveOpen = $state(false);

	// The header reads the viewer from the root layout, so everything is reloaded after a change.
	async function run(action: () => Promise<unknown>, done: string) {
		isBusy = true;
		message = null;
		try {
			await action();
			await invalidateAll();
			draft = null;
			message = { text: done, isError: false };
		} catch (error) {
			message = {
				text: error instanceof Error ? error.message : 'Something went wrong.',
				isError: true
			};
		} finally {
			isBusy = false;
		}
	}

	function chooseFile(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget;
		const file = input.files?.[0];
		// Cleared so choosing the same file again after a failure still fires.
		input.value = '';
		if (file) void run(() => uploadMyAvatar(file), 'Picture updated.');
	}
</script>

<svelte:head>
	<title>Profile · Epoch</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-2xl flex-col gap-8">
	<header>
		<h2 class="text-2xl font-bold text-stone-900">Profile</h2>
		<p class="mt-1 text-sm text-stone-600">How you appear to the people you share trees with.</p>
	</header>

	<section aria-labelledby="picture-heading" class="flex flex-col gap-3">
		<h3 id="picture-heading" class="text-lg font-bold text-stone-900">Picture</h3>
		<div class="flex flex-wrap items-center gap-4">
			<Avatar name={profile.name} email={profile.email} src={profile.avatarUrl} size="lg" />
			<div class="flex flex-wrap gap-2">
				<label
					class="btn-primary-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-600 has-[:focus-visible]:ring-offset-2 {isBusy
						? 'opacity-50'
						: ''}"
				>
					Upload a picture
					<input
						type="file"
						accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
						class="sr-only"
						disabled={isBusy}
						onchange={chooseFile}
					/>
				</label>
				{#if profile.canUseAccessPicture}
					<button
						type="button"
						class="btn-primary-sm"
						disabled={isBusy}
						onclick={() => void run(useMyAccessPicture, 'Using your Google picture.')}
					>
						Use my Google picture
					</button>
				{/if}
				{#if profile.avatarUrl}
					<button
						type="button"
						class="btn-primary-sm"
						disabled={isBusy}
						onclick={() => void run(removeMyAvatar, 'Picture removed.')}
					>
						Remove picture
					</button>
				{/if}
			</div>
		</div>
		<p class="text-xs text-stone-600">
			JPEG, PNG, GIF, WebP or AVIF, up to 2 MB. Without one, your initials are shown.
		</p>
	</section>

	<section aria-labelledby="details-heading" class="flex flex-col gap-3">
		<h3 id="details-heading" class="text-lg font-bold text-stone-900">Details</h3>
		<div>
			<label class="field-label" for="profile-email">Email</label>
			<input id="profile-email" class="field-input bg-stone-100" value={profile.email} readonly />
			<p class="mt-1 text-xs text-stone-600">Set by your sign-in; it cannot be changed here.</p>
		</div>
		<form
			class="flex flex-col gap-2"
			onsubmit={(event) => {
				event.preventDefault();
				void run(() => saveMyName(name), 'Name saved.');
			}}
		>
			<label class="field-label" for="profile-name">Display name</label>
			<input
				id="profile-name"
				class="field-input"
				value={name}
				maxlength={MAX_DISPLAY_NAME_LENGTH}
				required
				oninput={(event) => (draft = event.currentTarget.value)}
			/>
			<div>
				<button type="submit" class="btn-primary" disabled={isBusy || !name.trim()}>
					Save name
				</button>
			</div>
		</form>
		<p
			role="status"
			class="min-h-5 text-sm font-medium {message?.isError ? 'text-red-800' : 'text-emerald-900'}"
		>
			{message?.text ?? ''}
		</p>
	</section>

	<section
		aria-labelledby="leave-heading"
		class="flex flex-col gap-2 border-t border-stone-200 pt-6"
	>
		<h3 id="leave-heading" class="text-lg font-bold text-stone-900">Leave Epoch</h3>
		<p id="leave-hint" class="text-sm text-stone-600">
			Leaving is not available yet. Select the button to see what it will do.
		</p>
		<div class="flex flex-wrap gap-2">
			<!-- aria-disabled, not disabled: it looks off but still opens the explanation. -->
			<button
				type="button"
				class="btn-primary-sm opacity-50"
				aria-disabled="true"
				aria-describedby="leave-hint"
				onclick={() => (isLeaveOpen = true)}
			>
				Leave Epoch
			</button>
		</div>
	</section>
</div>

<LeaveEpochDialog isOpen={isLeaveOpen} onclose={() => (isLeaveOpen = false)} />
