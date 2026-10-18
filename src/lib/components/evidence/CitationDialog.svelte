<script lang="ts">
	import { untrack } from 'svelte';
	import { Quote } from '@lucide/svelte';
	import DateInput from '#lib/components/forms/DateInput.svelte';
	import BaseModal from '#lib/components/modals/BaseModal.svelte';
	import { createSubmission } from '#lib/components/forms/submission.svelte.js';
	import { addCitationApi, updateCitationApi } from '#lib/api/evidence.js';
	import SourcePicker from './SourcePicker.svelte';
	import { checkDateEdit } from '#lib/shared/date-value.js';
	import {
		CITATION_QUALITY_LABELS,
		isCitationQuality,
		type CitationDto,
		type CitationQuality,
		type CitationSubjectRef
	} from '#lib/shared/evidence.js';
	import type { ChangeSummary } from '#lib/types/genealogy.js';

	interface Props {
		isOpen: boolean;
		treeId: string;
		/** What the citation supports, in words, for the dialog's subtitle ("the birth of Ann Ash"). */
		subjectLabel: string;
		subject: CitationSubjectRef;
		/** The citation being edited, or null to add one. */
		citation: CitationDto | null;
		/** Called after a save, with the change so the caller can offer Undo. */
		onsaved: (change: ChangeSummary | null) => void | Promise<void>;
		/** Called when the citation changed under the editor; the caller reloads. */
		onstale: (message: string) => void | Promise<void>;
		oncancel: () => void;
	}

	let { isOpen, treeId, subjectLabel, subject, citation, onsaved, onstale, oncancel }: Props =
		$props();

	let sourceId = $state<string | null>(null);
	let sourceName = $state('');
	let page = $state('');
	let quality = $state<string>('');
	let entryDate = $state('');
	let savedEntryDate = $state<string | null>(null);
	let text = $state('');
	const submission = createSubmission((message) => onstale(message));

	const isDateValid = $derived(checkDateEdit(entryDate, savedEntryDate).isValid);
	const field =
		'w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600';
	const QUALITY_CHOICES = (Object.keys(CITATION_QUALITY_LABELS) as unknown as string[])
		.map(Number)
		.sort((a, b) => b - a) as CitationQuality[];

	// Filled when the dialog opens only: reading `citation` inside an effect that also watches the
	// fields would wipe what has been typed whenever the page data reloads underneath it.
	$effect(() => {
		if (!isOpen) return;
		const from = untrack(() => citation);
		sourceId = from?.sourceId ?? null;
		sourceName = from?.sourceLabel ?? '';
		page = from?.page ?? '';
		quality = from?.quality === null || from?.quality === undefined ? '' : String(from.quality);
		entryDate = from?.entryDate ?? '';
		savedEntryDate = from?.entryDate ?? null;
		text = from?.text ?? '';
		submission.error = null;
	});

	async function save() {
		if (!sourceId) {
			submission.error = 'Choose the source this citation is from.';
			return;
		}
		if (!isDateValid) {
			submission.error = 'Fix the highlighted date before saving.';
			return;
		}
		const parsedQuality = quality === '' ? null : Number(quality);
		const input = {
			page: page.trim() || null,
			quality: isCitationQuality(parsedQuality) ? parsedQuality : null,
			entryDate: entryDate.trim() || null,
			text: text.trim() || null
		};
		await submission.submit(async () => {
			const { change } = citation
				? await updateCitationApi(
						treeId,
						citation.id,
						{ ...input, ...(sourceId !== citation.sourceId ? { sourceId } : {}) },
						citation.version
					)
				: await addCitationApi(treeId, subject, { ...input, sourceId });
			await onsaved(change);
		}, 'Could not save the citation');
	}
</script>

<BaseModal
	{isOpen}
	title={citation ? 'Edit citation' : 'Add a citation'}
	subtitle={`For ${subjectLabel}`}
	icon={Quote}
	maxWidthClass="max-w-lg"
	error={submission.error}
	onclose={oncancel}
>
	<form
		class="space-y-3"
		data-testid="citation-form"
		onsubmit={(event) => {
			event.preventDefault();
			void save();
		}}
	>
		<fieldset class="space-y-2">
			<legend class="field-label">Source</legend>
			<SourcePicker
				{treeId}
				idPrefix="citation"
				bind:sourceId
				bind:sourceName
				onerror={(message) => (submission.error = message)}
				shouldFocus={isOpen}
			/>
		</fieldset>

		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="citation-page" class="field-label">Where in it</label>
				<input
					id="citation-page"
					type="text"
					bind:value={page}
					class={field}
					placeholder="e.g. page 12, entry 4"
				/>
			</div>
			<div>
				<label for="citation-date" class="field-label">Recorded on</label>
				<DateInput
					id="citation-date"
					bind:value={entryDate}
					savedValue={savedEntryDate}
					inputClass={field}
				/>
			</div>
		</div>
		<div>
			<label for="citation-quality" class="field-label">How reliable is it</label>
			<select id="citation-quality" bind:value={quality} class={field}>
				<option value="">Not stated</option>
				{#each QUALITY_CHOICES as choice (choice)}
					<option value={String(choice)}>{CITATION_QUALITY_LABELS[choice]}</option>
				{/each}
			</select>
		</div>
		<div>
			<label for="citation-text" class="field-label"
				>Words from the source <span class="font-normal text-stone-500">(optional)</span></label
			>
			<textarea id="citation-text" rows="3" bind:value={text} class={field}></textarea>
		</div>

		<div class="flex gap-2 pt-1">
			<button
				type="button"
				onclick={oncancel}
				class="flex-1 cursor-pointer rounded-lg bg-stone-200 py-2 font-semibold text-stone-700 hover:bg-stone-300"
				>Cancel</button
			>
			<button
				type="submit"
				disabled={submission.isSaving || !sourceId || !isDateValid}
				class="btn-primary flex-1"
				>{submission.isSaving ? 'Saving…' : citation ? 'Save citation' : 'Add citation'}</button
			>
		</div>
	</form>
</BaseModal>
