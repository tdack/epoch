<script lang="ts">
	import { untrack } from 'svelte';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import { savePrivacySettings } from '#lib/api/people.js';
	import {
		MAX_MAX_ALIVE_YEARS,
		MAX_RECENT_DEATH_YEARS,
		MIN_MAX_ALIVE_YEARS
	} from '#lib/shared/privacy.js';
	import type { PrivacySettingsDto } from '#lib/shared/privacy.js';

	interface Props {
		treeId: string;
		/** What the server holds now; the fields start from it and the saved answer replaces them. */
		settings: PrivacySettingsDto;
		toasts: ToastStore;
	}

	let { treeId, settings, toasts }: Props = $props();

	let maxAliveYears = $state(untrack(() => settings.maxAliveYears));
	let recentDeathYears = $state(untrack(() => settings.recentDeathYears));
	let shouldShowPrivateStructure = $state(untrack(() => settings.shouldShowPrivateStructure));
	// What the server holds now, to put a refused checkbox back where it was.
	let wasShowingStructure = untrack(() => settings.shouldShowPrivateStructure);
	let isSaving = $state(false);
	// A checkbox saves on change (ADR-075), so a polite live region says so for people who do not see toasts.
	let announcement = $state('');

	const isValid = $derived(
		Number.isInteger(maxAliveYears) &&
			maxAliveYears >= MIN_MAX_ALIVE_YEARS &&
			maxAliveYears <= MAX_MAX_ALIVE_YEARS
	);
	const isRecentDeathValid = $derived(
		Number.isInteger(recentDeathYears) &&
			recentDeathYears >= 0 &&
			recentDeathYears <= MAX_RECENT_DEATH_YEARS
	);

	/** Sends only what changed, so a half-typed number is never saved by ticking the box. */
	async function save(patch: Partial<PrivacySettingsDto>, done: string) {
		if (isSaving) return;
		isSaving = true;
		try {
			const saved = await savePrivacySettings(treeId, patch);
			maxAliveYears = saved.maxAliveYears;
			recentDeathYears = saved.recentDeathYears;
			shouldShowPrivateStructure = wasShowingStructure = saved.shouldShowPrivateStructure;
			announcement = done;
			toasts.push(done);
		} catch (cause) {
			// Put the box back where the server has it.
			shouldShowPrivateStructure = wasShowingStructure;
			toasts.push(messageOf(cause, 'Could not save the privacy settings'), { tone: 'error' });
		} finally {
			isSaving = false;
		}
	}

	function saveYears(event: SubmitEvent) {
		event.preventDefault();
		if (isValid) void save({ maxAliveYears }, 'Living-person rule saved');
	}

	function saveRecentDeath(event: SubmitEvent) {
		event.preventDefault();
		if (isRecentDeathValid)
			void save(
				{ recentDeathYears },
				recentDeathYears === 0 ? 'The recently dead are shown' : 'Recent-death rule saved'
			);
	}
</script>

<div class="mt-4 max-w-2xl space-y-6 rounded-xl border border-stone-200 bg-white p-5">
	<form onsubmit={saveYears}>
		<label for="max-alive" class="block text-sm font-semibold text-stone-800"
			>Assume someone has died after this many years</label
		>
		<p id="max-alive-help" class="mt-1 text-xs text-stone-600">
			A person with a death, burial or cremation fact, or any of their own facts (a birth, census,
			occupation or residence) that ended more than this many years ago, is shown. A marriage
			belongs to the partnership, so it does not count. Everyone else, including anyone with no
			dated fact, is hidden from contributors and viewers. Owners, managers and editors see
			everyone.
		</p>
		<div class="mt-2 flex flex-wrap items-center gap-2">
			<input
				id="max-alive"
				type="number"
				min={MIN_MAX_ALIVE_YEARS}
				max={MAX_MAX_ALIVE_YEARS}
				step="1"
				bind:value={maxAliveYears}
				aria-describedby="max-alive-help"
				class="w-24 rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
			/>
			<span class="text-sm text-stone-600"
				>years ({MIN_MAX_ALIVE_YEARS} to {MAX_MAX_ALIVE_YEARS})</span
			>
			<button type="submit" disabled={!isValid || isSaving} class="btn-primary">Save</button>
		</div>
		{#if !isValid}<p class="mt-1 text-xs text-red-700" role="alert">
				Enter a whole number from {MIN_MAX_ALIVE_YEARS} to {MAX_MAX_ALIVE_YEARS}.
			</p>{/if}
	</form>

	<form onsubmit={saveRecentDeath}>
		<label for="recent-death" class="block text-sm font-semibold text-stone-800"
			>Keep people hidden for this many years after they die</label
		>
		<p id="recent-death-help" class="mt-1 text-xs text-stone-600">
			A death, burial or cremation dated this recently hides the person as if they were living. A
			death with no date counts as long ago. 0 shows the dead however recently they died.
		</p>
		<div class="mt-2 flex flex-wrap items-center gap-2">
			<input
				id="recent-death"
				type="number"
				min="0"
				max={MAX_RECENT_DEATH_YEARS}
				step="1"
				bind:value={recentDeathYears}
				aria-describedby="recent-death-help"
				class="w-24 rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
			/>
			<span class="text-sm text-stone-600">years (0 to {MAX_RECENT_DEATH_YEARS})</span>
			<button type="submit" disabled={!isRecentDeathValid || isSaving} class="btn-primary"
				>Save</button
			>
		</div>
		{#if !isRecentDeathValid}<p class="mt-1 text-xs text-red-700" role="alert">
				Enter a whole number from 0 to {MAX_RECENT_DEATH_YEARS}.
			</p>{/if}
	</form>

	<label
		class="flex cursor-pointer items-start justify-between gap-4 text-sm font-semibold text-stone-800"
	>
		<span>
			Show hidden people as "Private" in the tree
			<span class="mt-1 block text-xs font-normal text-stone-600">
				Relationships stay visible, with no name, dates, places or notes. Off, hidden people are
				left out, and so is anyone only reachable through them.
			</span>
		</span>
		<input
			type="checkbox"
			bind:checked={shouldShowPrivateStructure}
			disabled={isSaving}
			onchange={() =>
				save(
					{ shouldShowPrivateStructure },
					shouldShowPrivateStructure
						? 'Hidden people now show as Private'
						: 'Hidden people are left out'
				)}
			class="switch mt-0.5"
		/>
	</label>
	<p class="sr-only" role="status" aria-live="polite">{announcement}</p>
</div>
