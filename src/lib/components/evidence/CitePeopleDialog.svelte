<script lang="ts">
	import { Quote, X } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import { citePeopleApi } from '#lib/api/evidence.js';
	import { searchPeopleApi } from '#lib/api/lists.js';
	import { createSubmission } from '#lib/components/forms/submission.svelte.js';
	import DateInput from '#lib/components/forms/DateInput.svelte';
	import BaseModal from '#lib/components/modals/BaseModal.svelte';
	import { checkDateEdit } from '#lib/shared/date-value.js';
	import {
		CITATION_QUALITY_LABELS,
		isCitationQuality,
		type CitationQuality
	} from '#lib/shared/evidence.js';
	import { FACT_TYPE_LIST, MAX_GROUP_FACT_PEOPLE } from '#lib/shared/fact-types.js';
	import type { ChangeSummary, PeopleSearchResult } from '#lib/types/genealogy.js';
	import SourcePicker from './SourcePicker.svelte';

	interface Props {
		isOpen: boolean;
		treeId: string;
		/** The source to cite, when it is already chosen (the source page); null shows a picker. */
		source: { id: string; name: string } | null;
		/** The people chosen when the dialog opens, e.g. a family's partners and children. */
		initialPeople?: Array<{ id: string; name: string }>;
		/**
		 * Called after a save, with the change, the names already cited (so skipped), and, when citing
		 * a fact type, the names with no such fact.
		 */
		onsaved: (
			change: ChangeSummary | null,
			skippedNames: string[],
			missingFactNames: string[]
		) => void | Promise<void>;
		oncancel: () => void;
	}

	let { isOpen, treeId, source, initialPeople = [], onsaved, oncancel }: Props = $props();

	const SEARCH_DELAY_MS = 250;
	const RESULTS_SHOWN = 8;
	const field =
		'w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600';
	const QUALITY_CHOICES = (Object.keys(CITATION_QUALITY_LABELS) as unknown as string[])
		.map(Number)
		.sort((a, b) => b - a) as CitationQuality[];

	let people = $state<Array<{ id: string; name: string }>>([]);
	let query = $state('');
	let results = $state<PeopleSearchResult[]>([]);
	let sourceId = $state<string | null>(null);
	let sourceName = $state('');
	let isCitingFact = $state(false);
	let factType = $state('BIRT');
	let page = $state('');
	let quality = $state('');
	let entryDate = $state('');
	let text = $state('');
	let searchRequest = 0;
	const submission = createSubmission(() => oncancel());

	const isDateValid = $derived(checkDateEdit(entryDate, null).isValid);
	const chosenSourceId = $derived(source?.id ?? sourceId);
	const nameOf = (p: PeopleSearchResult) =>
		[p.givenName, p.surname].filter(Boolean).join(' ') || 'Unnamed';

	$effect(() => {
		if (!isOpen) return;
		untrack(() => {
			people = [...initialPeople];
			query = '';
			results = [];
			sourceId = null;
			sourceName = '';
			isCitingFact = false;
			factType = 'BIRT';
			page = '';
			quality = '';
			entryDate = '';
			text = '';
			submission.error = null;
		});
	});

	$effect(() => {
		const q = query.trim();
		if (!isOpen || q.length < 2) {
			results = [];
			return;
		}
		const timer = setTimeout(async () => {
			const request = ++searchRequest;
			try {
				const found = await searchPeopleApi(treeId, q);
				if (request === searchRequest) results = found;
			} catch {
				if (request === searchRequest) results = [];
			}
		}, SEARCH_DELAY_MS);
		return () => clearTimeout(timer);
	});

	function add(person: PeopleSearchResult) {
		query = '';
		results = [];
		if (people.some((p) => p.id === person.id)) return;
		if (people.length >= MAX_GROUP_FACT_PEOPLE) {
			submission.error = `A citation can be added for at most ${MAX_GROUP_FACT_PEOPLE} people at a time.`;
			return;
		}
		people = [...people, { id: person.id, name: nameOf(person) }];
	}

	async function save() {
		if (!chosenSourceId) {
			submission.error = 'Choose the source to cite.';
			return;
		}
		if (people.length === 0) {
			submission.error = 'Add at least one person.';
			return;
		}
		if (!isDateValid) {
			submission.error = 'Fix the highlighted date before saving.';
			return;
		}
		const parsed = quality === '' ? null : Number(quality);
		await submission.submit(async () => {
			const { change, skippedPersonIds, missingFactPersonIds } = await citePeopleApi(
				treeId,
				people.map((p) => p.id),
				{
					sourceId: chosenSourceId,
					page: page.trim() || null,
					quality: isCitationQuality(parsed) ? parsed : null,
					entryDate: entryDate.trim() || null,
					text: text.trim() || null
				},
				isCitingFact ? factType : undefined
			);
			const namesOf = (ids: string[]) =>
				people.filter((p) => ids.includes(p.id)).map((p) => p.name);
			await onsaved(change, namesOf(skippedPersonIds), namesOf(missingFactPersonIds));
		}, 'Could not add the citations');
	}
</script>

<BaseModal
	{isOpen}
	title="Cite for people"
	subtitle={source ? `“${source.name}”` : 'One citation on each person or fact'}
	icon={Quote}
	maxWidthClass="max-w-lg"
	error={submission.error}
	onclose={oncancel}
>
	<form
		class="space-y-3"
		data-testid="cite-people-form"
		onsubmit={(event) => {
			event.preventDefault();
			void save();
		}}
	>
		{#if !source}
			<fieldset class="space-y-2">
				<legend class="field-label">Source</legend>
				<SourcePicker
					{treeId}
					idPrefix="cite-people"
					bind:sourceId
					bind:sourceName
					onerror={(message) => (submission.error = message)}
				/>
			</fieldset>
		{/if}

		<div>
			<label for="cite-people-search" class="field-label">People</label>
			<ul class="mb-2 flex flex-wrap gap-1.5" data-testid="cite-people-chips">
				{#each people as person (person.id)}
					<li
						class="inline-flex items-center gap-1 rounded-full bg-stone-100 py-0.5 pr-1 pl-2.5 text-sm"
					>
						{person.name}
						<button
							type="button"
							class="cursor-pointer rounded-full p-1 text-stone-600 hover:bg-stone-200 coarse:p-2"
							aria-label={`Remove ${person.name}`}
							onclick={() => (people = people.filter((p) => p.id !== person.id))}
							><X class="h-3 w-3" /></button
						>
					</li>
				{/each}
			</ul>
			<input
				id="cite-people-search"
				type="search"
				bind:value={query}
				class={field}
				placeholder="Search by name to add a person"
				autocomplete="off"
			/>
			{#if results.length > 0}
				<ul
					class="mt-1 rounded-lg border border-stone-200 bg-white"
					data-testid="cite-people-results"
				>
					{#each results.slice(0, RESULTS_SHOWN) as person (person.id)}
						<li>
							<button
								type="button"
								class="w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-stone-100 coarse:min-h-11"
								onclick={() => add(person)}
								>{nameOf(person)}
								{#if person.birthDate}<span class="text-xs text-stone-500"
										>b. {person.birthDate}</span
									>{/if}</button
							>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<fieldset class="space-y-2">
			<legend class="field-label">Cite on</legend>
			<label class="flex items-center gap-2 text-sm">
				<input type="radio" name="cite-people-target" value={false} bind:group={isCitingFact} />
				Each person
			</label>
			<label class="flex items-center gap-2 text-sm">
				<input type="radio" name="cite-people-target" value={true} bind:group={isCitingFact} />
				A fact of each person
			</label>
			{#if isCitingFact}
				<select
					bind:value={factType}
					class={field}
					aria-label="Fact type"
					data-testid="cite-people-fact-type"
				>
					{#each FACT_TYPE_LIST as info (info.code)}
						<option value={info.code}>{info.label}</option>
					{/each}
				</select>
			{/if}
		</fieldset>

		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="cite-people-page" class="field-label">Where in it</label>
				<input
					id="cite-people-page"
					type="text"
					bind:value={page}
					class={field}
					placeholder="e.g. page 12"
				/>
			</div>
			<div>
				<label for="cite-people-date" class="field-label">Recorded on</label>
				<DateInput
					id="cite-people-date"
					bind:value={entryDate}
					savedValue={null}
					inputClass={field}
				/>
			</div>
		</div>
		<div>
			<label for="cite-people-quality" class="field-label">How reliable is it</label>
			<select id="cite-people-quality" bind:value={quality} class={field}>
				<option value="">Not stated</option>
				{#each QUALITY_CHOICES as choice (choice)}
					<option value={String(choice)}>{CITATION_QUALITY_LABELS[choice]}</option>
				{/each}
			</select>
		</div>
		<div>
			<label for="cite-people-text" class="field-label"
				>Words from the source <span class="font-normal text-stone-500">(optional)</span></label
			>
			<textarea id="cite-people-text" rows="3" bind:value={text} class={field}></textarea>
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
				disabled={submission.isSaving || !chosenSourceId || people.length === 0 || !isDateValid}
				class="btn-primary flex-1"
				>{submission.isSaving
					? 'Saving…'
					: `Cite for ${people.length} ${people.length === 1 ? 'person' : 'people'}`}</button
			>
		</div>
	</form>
</BaseModal>
