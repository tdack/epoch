<script lang="ts">
	import PlaceInput from '#lib/components/forms/PlaceInput.svelte';
	import { tick } from 'svelte';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import { createSubmission } from '#lib/components/forms/submission.svelte.js';
	import ImpactDialog from './ImpactDialog.svelte';
	import { previewPlaceRewriteApi, rewritePlaceApi } from '#lib/api/lists.js';
	import type { ChangeSummary, ImpactSummary } from '#lib/types/genealogy.js';

	interface Props {
		isOpen: boolean;
		treeId: string;
		/** The place being changed: its record and the name it has now. */
		placeId: string;
		currentName: string;
		/** Called after a save, with the change so the caller can offer Undo, and the text the place now has. */
		onsaved: (change: ChangeSummary | null, name: string) => void | Promise<void>;
		oncancel: () => void;
	}

	let { isOpen, treeId, placeId, currentName, onsaved, oncancel }: Props = $props();

	const PREVIEW_DELAY_MS = 250;
	const field =
		'w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600';

	let name = $state('');
	let impact = $state<ImpactSummary | null>(null);
	let previewError = $state<string | null>(null);
	const submission = createSubmission((message) => {
		submission.error = `${message} Close this and try again.`;
	});
	let input = $state<HTMLInputElement | null>(null);
	let previewRequest = 0;

	const isUnchanged = $derived(name.trim() === '' || name.trim() === currentName);

	$effect(() => {
		if (!isOpen) return;
		name = currentName;
		impact = null;
		previewError = null;
		submission.clearError();
		void tick().then(() => input?.select());
	});

	// What the change would write, planned on the server, so the list is the one the save runs.
	$effect(() => {
		if (!isOpen) return;
		const typed = name.trim();
		const isIdle = isUnchanged;
		const timer = setTimeout(async () => {
			const request = ++previewRequest;
			if (isIdle) {
				impact = null;
				previewError = null;
				return;
			}
			try {
				const next = await previewPlaceRewriteApi(treeId, placeId, typed);
				if (request !== previewRequest) return;
				impact = next;
				previewError = null;
			} catch (cause: unknown) {
				if (request !== previewRequest) return;
				impact = null;
				previewError = messageOf(cause, 'Could not preview the change');
			}
		}, PREVIEW_DELAY_MS);
		return () => clearTimeout(timer);
	});

	async function save() {
		if (isUnchanged) return;
		await submission.submit(async () => {
			const { change, name: saved } = await rewritePlaceApi(treeId, placeId, name.trim());
			await onsaved(change, saved);
		}, 'Could not change the place');
	}
</script>

<ImpactDialog
	{isOpen}
	title="Rename or merge this place"
	{impact}
	isLoading={isOpen && !isUnchanged && impact === null && previewError === null}
	isConfirming={submission.isSaving}
	error={submission.error ?? previewError}
	confirmLabel="Change place"
	idleMessage="Type a new name to see which facts change."
	isConfirmBlocked={isUnchanged}
	onconfirm={save}
	{oncancel}
>
	{#snippet controls()}
		<form
			class="space-y-2"
			data-testid="place-form"
			onsubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<label for="place-name" class="block text-xs font-semibold text-stone-700"
				>Name on every fact at this place</label
			>
			<PlaceInput
				id="place-name"
				{treeId}
				bind:element={input}
				bind:value={name}
				inputClass={field}
			/>
			<p class="text-xs text-stone-600">
				Choose the name of another place to merge this one into it. One Undo puts everything back.
			</p>
		</form>
	{/snippet}
</ImpactDialog>
