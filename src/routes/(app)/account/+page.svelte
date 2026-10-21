<script lang="ts">
	import { invalidate, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import PageTabs from '#lib/components/layout/PageTabs.svelte';
	import { hashTab } from '#lib/components/layout/hash-tab.js';
	import Avatar from '#lib/components/profile/Avatar.svelte';
	import LeaveEpochDialog from '#lib/components/modals/LeaveEpochDialog.svelte';
	import PaletteEditor from '#lib/components/settings/PaletteEditor.svelte';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import {
		leaveEpoch,
		removeMyAvatar,
		saveMyName,
		uploadMyAvatar,
		useMyAccessPicture
	} from '#lib/api/profile.js';
	import { saveDefaultTree, saveMySettings, saveViewMode } from '#lib/api/settings.js';
	import { signOutHref } from '#lib/shared/access.js';
	import { MAX_DISPLAY_NAME_LENGTH } from '#lib/shared/profile.js';
	import { SETTINGS_DEPENDENCY, type SettingsPatch } from '#lib/shared/settings.js';
	import { treePath } from '#lib/shared/tree-slug.js';
	import {
		LAYOUT_MODES,
		LAYOUT_MODE_VALUES,
		MODE_LABELS,
		parseLayoutMode
	} from '#lib/shared/view-mode.js';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	const TABS = [
		{ id: 'profile', label: 'Profile' },
		{ id: 'trees', label: 'My trees' },
		{ id: 'appearance', label: 'Appearance' },
		{ id: 'leave', label: 'Leave' }
	] as const;
	const tab = $derived(hashTab(page.url.hash, ['profile', 'trees', 'appearance', 'leave']));

	const quietButton =
		'inline-flex min-h-9 cursor-pointer items-center justify-center rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-800 shadow-xs focus-ring transition-colors hover:bg-stone-100 disabled:opacity-50';

	const profile = $derived(data.profile);
	const settings = $derived(data.settings);

	// Profile
	// Follows the stored name until the person types; reset once a save lands.
	let draft = $state<string | null>(null);
	const name = $derived(draft ?? profile.name ?? '');
	let isBusy = $state(false);
	let message = $state<{ text: string; isError: boolean } | null>(null);

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
			message = { text: messageOf(error, 'Something went wrong.'), isError: true };
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

	// Appearance
	// The root layout reads the palette every page paints with; reloading it repaints them all.
	async function saveMine(patch: SettingsPatch) {
		await saveMySettings(patch);
		await invalidate(SETTINGS_DEPENDENCY);
	}
	// Follows the stored choice; flipped at once on change so the box answers before the save does.
	let isMotionReduced = $derived(settings.user.isMotionReduced ?? false);
	let isSavingMotion = $state(false);
	let motion = $state<{ text: string; isError: boolean } | null>(null);
	async function saveMotion(isChecked: boolean) {
		isMotionReduced = isChecked;
		isSavingMotion = true;
		motion = null;
		try {
			// Off clears the choice rather than storing false: there is no site default to override.
			await saveMine({ isMotionReduced: isChecked ? true : null });
			motion = { text: 'Saved', isError: false };
		} catch (error) {
			isMotionReduced = !isChecked;
			motion = { text: messageOf(error, 'Could not save the setting.'), isError: true };
		} finally {
			isSavingMotion = false;
		}
	}

	// My trees
	const trees = $derived(data.trees);
	const defaultTreeId = $derived(trees.find((t) => t.isDefault)?.id ?? null);
	let isSavingTree = $state(false);
	let treesMessage = $state<{ text: string; isError: boolean } | null>(null);

	async function saveTree(work: () => Promise<void>, done: string) {
		isSavingTree = true;
		treesMessage = null;
		try {
			await work();
			await invalidateAll();
			treesMessage = { text: done, isError: false };
		} catch (error) {
			treesMessage = { text: messageOf(error, 'Could not save that.'), isError: true };
		} finally {
			isSavingTree = false;
		}
	}
	const setDefault = (id: string | null, treeName: string) =>
		saveTree(
			() => saveDefaultTree(id),
			id ? `Saved: ${treeName} opens first.` : 'Saved: Epoch opens your latest tree.'
		);
	const setViewMode = (id: string, treeName: string, value: string) =>
		saveTree(
			() => saveViewMode(id, parseLayoutMode(value)),
			`Saved: ${treeName} opens in ${value ? MODE_LABELS[parseLayoutMode(value)!] : 'Flat'}.`
		);

	// Leave Epoch
	let isLeaveOpen = $state(false);
	let isLeaving = $state(false);
	let leaveError = $state<string | null>(null);

	async function leave() {
		isLeaving = true;
		leaveError = null;
		try {
			await leaveEpoch(profile.email);
			// A full load, not goto: the Access session is what ends, and it is cleared by the server.
			window.location.assign(signOutHref(page.url.origin));
		} catch (error) {
			leaveError = messageOf(error, 'Something went wrong.');
			isLeaving = false;
		}
	}
</script>

<svelte:head>
	<title>Account · Epoch</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<header>
		<h1 class="text-2xl font-bold text-stone-900">Account</h1>
		<p class="mt-1 text-sm text-stone-600">
			Your profile and preferences. They apply in every tree you belong to.
		</p>
	</header>

	<div>
		<PageTabs
			label="Account"
			tabs={TABS.map((t) => ({ href: `#${t.id}`, label: t.label, isCurrent: t.id === tab }))}
		/>
		{#if tab === 'profile'}
			<section
				id="profile-tab"
				aria-labelledby="profile-heading"
				class="flex max-w-3xl scroll-mt-24 flex-col gap-4"
			>
				<h2 id="profile-heading" class="text-lg font-bold text-stone-900">Profile</h2>
				<div class="flex flex-wrap items-center gap-4">
					<Avatar name={profile.name} email={profile.email} src={profile.avatarUrl} size="lg" />
					<div class="flex flex-wrap gap-2">
						<label
							class="{quietButton} has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-600 has-[:focus-visible]:ring-offset-2 {isBusy
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
								class={quietButton}
								disabled={isBusy}
								onclick={() => void run(useMyAccessPicture, 'Using your Google picture.')}
							>
								Use my Google picture
							</button>
						{/if}
						{#if profile.avatarUrl}
							<button
								type="button"
								class={quietButton}
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
				<div>
					<label class="field-label" for="profile-email">Email</label>
					<input
						id="profile-email"
						class="field-input bg-stone-100"
						value={profile.email}
						readonly
					/>
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
					class="min-h-5 text-sm font-medium {message?.isError
						? 'text-red-800'
						: 'text-emerald-900'}"
				>
					{message?.text ?? ''}
				</p>
			</section>
		{:else if tab === 'trees'}
			<section
				id="trees-tab"
				aria-labelledby="trees-heading"
				class="flex max-w-3xl scroll-mt-24 flex-col gap-3"
			>
				<h2 id="trees-heading" class="text-lg font-bold text-stone-900">My trees</h2>
				<p class="text-sm text-stone-600">
					{#if trees.length > 1}
						Your default tree is the one Epoch opens when you sign in or select the Epoch mark.
					{:else}
						Your default tree is the one Epoch opens when you sign in.
					{/if}
					A tree opens in the view you choose here, unless a link names another.
				</p>
				{#if trees.length === 0}
					<p class="text-sm text-stone-700">You are not in any tree yet.</p>
				{:else}
					<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-xs">
						<table class="w-full text-left text-sm">
							<thead class="border-b border-stone-200 bg-stone-50 text-xs text-stone-600">
								<tr>
									<th scope="col" class="px-3 py-2 font-semibold">Tree</th>
									<th scope="col" class="px-3 py-2 font-semibold">Your role</th>
									{#if trees.length > 1}
										<th scope="col" class="px-3 py-2 font-semibold">Default</th>
									{/if}
									<th scope="col" class="px-3 py-2 font-semibold">Open in</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-stone-100">
								{#each trees as tree (tree.id)}
									<tr>
										<th scope="row" class="px-3 py-2 font-semibold text-stone-900">
											<a href={treePath(tree)} class="hover:underline">{tree.name}</a>
										</th>
										<td class="px-3 py-2 text-stone-600 capitalize">{tree.role ?? ''}</td>
										{#if trees.length > 1}
											<td class="px-3 py-2">
												<input
													type="radio"
													name="default-tree"
													class="h-4 w-4"
													aria-label="Default tree: {tree.name}"
													checked={tree.id === defaultTreeId}
													disabled={isSavingTree}
													onchange={() => void setDefault(tree.id, tree.name)}
												/>
											</td>
										{/if}
										<td class="px-3 py-2">
											<select
												class="field-input w-auto py-1 text-xs"
												aria-label="Open {tree.name} in"
												value={tree.viewMode === LAYOUT_MODES.FLAT ? '' : (tree.viewMode ?? '')}
												disabled={isSavingTree}
												onchange={(event) =>
													void setViewMode(tree.id, tree.name, event.currentTarget.value)}
											>
												<option value="">Flat (the default)</option>
												{#each LAYOUT_MODE_VALUES.filter((m) => m !== LAYOUT_MODES.FLAT) as mode (mode)}
													<option value={mode}>{MODE_LABELS[mode]}</option>
												{/each}
											</select>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					{#if trees.length > 1 && defaultTreeId}
						<div>
							<button
								type="button"
								class={quietButton}
								disabled={isSavingTree}
								onclick={() => void setDefault(null, '')}
							>
								No default tree
							</button>
						</div>
					{/if}
				{/if}
				<p
					role="status"
					class="min-h-5 text-sm font-medium {treesMessage?.isError
						? 'text-red-800'
						: 'text-emerald-900'}"
				>
					{treesMessage?.text ?? ''}
				</p>
			</section>
		{:else if tab === 'appearance'}
			<section
				id="appearance-tab"
				aria-labelledby="appearance-heading"
				class="flex max-w-3xl scroll-mt-24 flex-col gap-4"
			>
				<h2 id="appearance-heading" class="text-lg font-bold text-stone-900">Appearance</h2>
				<div class="flex flex-col gap-3">
					<h3 class="text-sm font-semibold text-stone-900">My colours</h3>
					<PaletteEditor
						idPrefix="mine"
						stored={settings.user}
						below={[settings.site]}
						inheritedName="the site default"
						onsave={saveMine}
					/>
				</div>
				<div class="flex flex-col gap-2">
					<label class="flex items-start gap-2 text-sm text-stone-800">
						<input
							type="checkbox"
							class="mt-0.5 h-4 w-4"
							checked={isMotionReduced}
							disabled={isSavingMotion}
							onchange={(event) => void saveMotion(event.currentTarget.checked)}
							aria-describedby="motion-hint motion-status"
						/>
						<span>
							<span class="font-semibold">Reduce animation</span>
							<span id="motion-hint" class="block text-xs text-stone-600">
								Holds the tree still: no gliding between people, no spinning or drifting in the 3D
								views. If your device already asks for less motion, that applies whatever you choose
								here.
							</span>
						</span>
					</label>
					<p
						id="motion-status"
						role="status"
						class="min-h-5 text-sm font-medium {motion?.isError
							? 'text-red-800'
							: 'text-emerald-900'}"
					>
						{motion?.text ?? ''}
					</p>
				</div>
			</section>
		{:else}
			<section
				id="leave-tab"
				aria-labelledby="leave-heading"
				class="flex max-w-3xl scroll-mt-24 flex-col gap-2"
			>
				<h2 id="leave-heading" class="text-lg font-bold text-stone-900">Leave Epoch</h2>
				<p class="text-sm text-stone-600">
					Remove yourself from every tree. You cannot undo this yourself; a tree owner would have to
					invite you back.
				</p>
				<div class="flex flex-wrap gap-2">
					<button
						type="button"
						class="inline-flex cursor-pointer items-center rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-red-600"
						onclick={() => {
							leaveError = null;
							isLeaveOpen = true;
						}}
					>
						Leave Epoch
					</button>
				</div>
			</section>
		{/if}
	</div>
</div>

<LeaveEpochDialog
	isOpen={isLeaveOpen}
	email={profile.email}
	blockers={data.leave}
	{isLeaving}
	error={leaveError}
	onclose={() => (isLeaveOpen = false)}
	onleave={leave}
/>
