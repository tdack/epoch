<script lang="ts">
	import { untrack } from 'svelte';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import { savePrivacySettings } from '#lib/api/people.js';
	import { MAX_MAX_ALIVE_YEARS, MIN_MAX_ALIVE_YEARS } from '#lib/shared/privacy.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const { toasts } = getTreeContext();

	// The form starts from what the server holds; saving writes it back, and the load is not re-run,
	// so the fields are the source of truth until the next visit.
	let maxAliveYears = $state(untrack(() => data.settings.maxAliveYears));
	let shouldShowPrivateStructure = $state(untrack(() => data.settings.shouldShowPrivateStructure));
	let isSaving = $state(false);

	const isValid = $derived(
		Number.isInteger(maxAliveYears) &&
			maxAliveYears >= MIN_MAX_ALIVE_YEARS &&
			maxAliveYears <= MAX_MAX_ALIVE_YEARS
	);

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!isValid || isSaving) return;
		isSaving = true;
		try {
			const saved = await savePrivacySettings(data.summary.tree.id, {
				maxAliveYears,
				shouldShowPrivateStructure
			});
			maxAliveYears = saved.maxAliveYears;
			shouldShowPrivateStructure = saved.shouldShowPrivateStructure;
			toasts.push('Privacy settings saved');
		} catch (cause) {
			toasts.push(messageOf(cause, 'Could not save the privacy settings'), {
				tone: 'error'
			});
		} finally {
			isSaving = false;
		}
	}
</script>

<svelte:head>
	<title>Privacy · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<h2 class="text-2xl font-bold text-stone-900">Privacy</h2>
<p class="mt-1 max-w-2xl text-sm text-stone-600">
	Contributors and viewers do not see people who may be living. Owners, managers and editors see
	everyone, and a contributor still sees the people they added themselves. You can force any one
	person public or private from their page.
</p>

<form
	onsubmit={save}
	class="mt-6 max-w-2xl space-y-6 rounded-xl border border-stone-200 bg-white p-5"
>
	<div>
		<label for="max-alive" class="block text-sm font-semibold text-stone-800"
			>Assume someone has died after this many years</label
		>
		<p id="max-alive-help" class="mt-1 text-xs text-stone-600">
			A person with a death, burial or cremation fact, or whose birth or baptism ended more than
			this many years ago, is shown. Everyone else, including anyone with no dated fact, is hidden.
		</p>
		<div class="mt-2 flex items-center gap-2">
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
		</div>
		{#if !isValid}<p class="mt-1 text-xs text-red-700" role="alert">
				Enter a whole number from {MIN_MAX_ALIVE_YEARS} to {MAX_MAX_ALIVE_YEARS}.
			</p>{/if}
	</div>

	<div>
		<label class="flex items-start gap-2 text-sm font-semibold text-stone-800">
			<input type="checkbox" bind:checked={shouldShowPrivateStructure} class="mt-0.5" />
			<span>
				Show hidden people as "Private" in the tree
				<span class="mt-1 block text-xs font-normal text-stone-600">
					Relationships stay visible, with no name, dates, places or notes. Off, hidden people are
					left out, and so is anyone only reachable through them.
				</span>
			</span>
		</label>
	</div>

	<button type="submit" disabled={!isValid || isSaving} class="btn-primary">
		{isSaving ? 'Saving…' : 'Save'}
	</button>
</form>
