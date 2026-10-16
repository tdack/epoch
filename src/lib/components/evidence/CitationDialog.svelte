<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import { Quote } from '@lucide/svelte';
	import DateInput from '#lib/components/forms/DateInput.svelte';
	import BaseModal from '#lib/components/modals/BaseModal.svelte';
	import { createSubmission } from '#lib/components/forms/submission.svelte.js';
	import {
		addCitationApi,
		createSourceApi,
		fetchSources,
		updateCitationApi
	} from '#lib/api/evidence.js';
	import { checkDateEdit } from '#lib/shared/date-value.js';
	import {
		CITATION_QUALITY_LABELS,
		isCitationQuality,
		type CitationDto,
		type CitationQuality,
		type CitationSubjectRef,
		type SourceListItem
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

	const SEARCH_DELAY_MS = 250;
	const RESULTS_SHOWN = 8;

	let sourceId = $state<string | null>(null);
	let sourceName = $state('');
	let isChoosing = $state(true);
	let query = $state('');
	let results = $state<SourceListItem[]>([]);
	let isNewSource = $state(false);
	let newTitle = $state('');
	let newAuthor = $state('');
	let page = $state('');
	let quality = $state<string>('');
	let entryDate = $state('');
	let savedEntryDate = $state<string | null>(null);
	let text = $state('');
	const submission = createSubmission((message) => onstale(message));
	let searchInput = $state<HTMLInputElement | null>(null);

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
		isChoosing = from === null;
		query = '';
		results = [];
		isNewSource = false;
		newTitle = '';
		newAuthor = '';
		page = from?.page ?? '';
		quality = from?.quality === null || from?.quality === undefined ? '' : String(from.quality);
		entryDate = from?.entryDate ?? '';
		savedEntryDate = from?.entryDate ?? null;
		text = from?.text ?? '';
		submission.error = null;
		void tick().then(() => searchInput?.focus());
	});

	// Sources matching what is typed, a few at a time: the tree may hold thousands.
	$effect(() => {
		const typed = query.trim();
		if (!isOpen || !isChoosing) return;
		const timer = setTimeout(async () => {
			try {
				const found = await fetchSources(
					treeId,
					new URLSearchParams({ q: typed, limit: String(RESULTS_SHOWN) })
				);
				results = found.items;
			} catch {
				results = [];
			}
		}, SEARCH_DELAY_MS);
		return () => clearTimeout(timer);
	});

	const labelOf = (source: SourceListItem) =>
		source.title || source.abbreviation || source.author || 'Untitled source';

	function choose(source: SourceListItem) {
		sourceId = source.id;
		sourceName = labelOf(source);
		isChoosing = false;
		isNewSource = false;
	}

	async function makeSource() {
		const title = newTitle.trim();
		if (!title) {
			submission.error = 'Give the new source a title.';
			return;
		}
		submission.error = null;
		try {
			const created = await createSourceApi(treeId, { title, author: newAuthor.trim() || null });
			sourceId = created.sourceId;
			sourceName = title;
			isChoosing = false;
			isNewSource = false;
		} catch (cause: unknown) {
			submission.error = messageOf(cause, 'Could not add the source');
		}
	}

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
			{#if !isChoosing && sourceId}
				<p class="flex items-center justify-between gap-2 text-sm">
					<span class="font-semibold text-stone-900" data-testid="chosen-source">{sourceName}</span>
					<button
						type="button"
						class="row-link text-xs font-semibold"
						onclick={() => (isChoosing = true)}>Change source</button
					>
				</p>
			{:else if isNewSource}
				<div class="space-y-2 rounded-lg border border-stone-300 bg-white p-3">
					<div>
						<label for="new-source-title" class="field-label">Title of the new source</label>
						<input id="new-source-title" type="text" bind:value={newTitle} class={field} />
					</div>
					<div>
						<label for="new-source-author" class="field-label"
							>Author <span class="font-normal text-stone-500">(optional)</span></label
						>
						<input id="new-source-author" type="text" bind:value={newAuthor} class={field} />
					</div>
					<div class="flex gap-2 text-sm font-semibold">
						<button type="button" class="action-btn" onclick={() => void makeSource()}
							>Add this source</button
						>
						<button type="button" class="row-link" onclick={() => (isNewSource = false)}
							>Back to search</button
						>
					</div>
				</div>
			{:else}
				<label for="citation-source-search" class="sr-only">Search sources by title or author</label
				>
				<input
					id="citation-source-search"
					type="search"
					bind:this={searchInput}
					bind:value={query}
					autocomplete="off"
					class={field}
					placeholder="Search by title or author"
				/>
				{#if results.length > 0}
					<ul
						class="max-h-40 divide-y divide-stone-200 overflow-y-auto rounded-lg border border-stone-300 bg-white text-sm"
						aria-label="Matching sources"
						data-testid="source-results"
					>
						{#each results as result (result.id)}
							<li>
								<button
									type="button"
									class="w-full cursor-pointer px-3 py-1.5 text-left hover:bg-emerald-50"
									onclick={() => choose(result)}
								>
									<span class="font-semibold text-stone-900">{labelOf(result)}</span>
									{#if result.author}<span class="text-xs text-stone-600">
											· {result.author}</span
										>{/if}
								</button>
							</li>
						{/each}
					</ul>
				{:else if query.trim()}
					<p class="text-xs text-stone-600">No source matches.</p>
				{/if}
				<button
					type="button"
					class="row-link text-xs font-semibold"
					onclick={() => (isNewSource = true)}>Make a new source…</button
				>
			{/if}
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
