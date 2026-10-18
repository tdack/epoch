<script lang="ts">
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import { tick, untrack } from 'svelte';
	import { createSubmission } from '#lib/components/forms/submission.svelte.js';
	import ImpactDialog from './ImpactDialog.svelte';
	import SourceSection from '#lib/components/evidence/SourceSection.svelte';
	import type { CitationDto, CitationInput } from '#lib/shared/evidence.js';
	import type { TreeRole } from '#lib/shared/roles.js';
	import DateInput from '#lib/components/forms/DateInput.svelte';
	import { checkDateEdit } from '#lib/shared/date-value.js';
	import {
		NAME_TYPE_LABELS,
		NAME_TYPE_LIST,
		isNameType,
		type NameInput,
		type NameType
	} from '#lib/shared/name-types.js';
	import type { NameDto } from '#lib/shared/person-page.js';
	import { createNameApi, previewNameApi, updateNameApi } from '#lib/api/people.js';
	import type { ChangeSummary, ImpactSummary } from '#lib/types/genealogy.js';

	interface Props {
		isOpen: boolean;
		treeId: string;
		personId: string;
		/** The name being edited, or null to add one. A derived name (no id) is edited on the person form, not here. */
		name: NameDto | null;
		/** The viewer's role; the optional Source section is shown only to a role that can cite. */
		role: TreeRole | undefined;
		/** The name's existing citations, listed in the Source section when editing. */
		citations?: CitationDto[];
		/** The partnerships this person is in, for "came from a partnership". */
		partnerships: Array<{ unionId: string; label: string }>;
		/** Called after a save, with the change so the caller can offer Undo. */
		onsaved: (change: ChangeSummary | null) => void | Promise<void>;
		/** Called when the name changed under the person; the caller reloads and reopens with what is stored. */
		onstale: (message: string) => void | Promise<void>;
		oncancel: () => void;
	}

	let {
		isOpen,
		treeId,
		personId,
		name,
		role,
		citations = [],
		partnerships,
		onsaved,
		onstale,
		oncancel
	}: Props = $props();

	const PREVIEW_DELAY_MS = 250;

	let type = $state<NameType>('married');
	let prefix = $state('');
	let givenName = $state('');
	let surnamePrefix = $state('');
	let surname = $state('');
	let suffix = $state('');
	let nickname = $state('');
	let dateText = $state('');
	let unionId = $state('');
	let isPreferred = $state(false);
	let citation = $state<CitationInput | null>(null);

	let impact = $state<ImpactSummary | null>(null);
	let previewError = $state<string | null>(null);
	const submission = createSubmission((message) => onstale(message));
	let typeSelect = $state<HTMLSelectElement | null>(null);
	let previewRequest = 0;

	const isEdit = $derived(name?.id != null);
	const isDateValid = $derived(checkDateEdit(dateText, name?.dateText).isValid);
	const hasContent = $derived(
		[prefix, givenName, surnamePrefix, surname, suffix, nickname].some((part) => part.trim() !== '')
	);
	const isReady = $derived(isDateValid && hasContent);
	const field =
		'w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600';

	const toInput = (): NameInput => ({
		type,
		prefix: prefix.trim() || null,
		givenName: givenName.trim() || null,
		surnamePrefix: surnamePrefix.trim() || null,
		surname: surname.trim() || null,
		suffix: suffix.trim() || null,
		nickname: nickname.trim() || null,
		dateText: dateText.trim() || null,
		unionId: unionId || null
	});

	// Fill the form only when the dialog opens, for the reason FactDialog does: a reload of the page
	// data underneath must not wipe what has been typed.
	$effect(() => {
		if (!isOpen) return;
		const source = untrack(() => name);
		type = source && isNameType(source.type) ? source.type : 'married';
		prefix = source?.prefix ?? '';
		givenName = source?.givenName ?? '';
		surnamePrefix = source?.surnamePrefix ?? '';
		surname = source?.surname ?? '';
		suffix = source?.suffix ?? '';
		nickname = source?.nickname ?? '';
		dateText = source?.dateText ?? '';
		unionId = source?.unionId ?? '';
		isPreferred = false;
		impact = null;
		previewError = null;
		submission.error = null;
		void tick().then(() => typeSelect?.focus());
	});

	// What the save would write, refreshed as the form changes. Planned on the server, so the list is
	// the same operations the save runs.
	$effect(() => {
		if (!isOpen) return;
		const input = toInput();
		const isNamePreferred = isPreferred;
		const isValid = isReady;
		const source = untrack(() => name);
		const timer = setTimeout(async () => {
			const request = ++previewRequest;
			if (!isValid) {
				impact = null;
				return;
			}
			try {
				const next = source?.id
					? await previewNameApi(treeId, {
							kind: 'update_name',
							nameId: source.id,
							version: source.version ?? undefined,
							name: input
						})
					: await previewNameApi(treeId, {
							kind: 'create_name',
							personId,
							name: { ...input, isPreferred: isNamePreferred }
						});
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
		if (!isReady) {
			submission.error = hasContent
				? 'Fix the highlighted date before saving.'
				: 'Give the name at least one part.';
			return;
		}
		await submission.submit(async () => {
			const input = toInput();
			const { change } = name?.id
				? await updateNameApi(treeId, name.id, input, name.version ?? 0, citation)
				: await createNameApi(treeId, personId, input, isPreferred, citation);
			await onsaved(change);
		}, 'Could not save the name');
	}
</script>

<ImpactDialog
	{isOpen}
	title={isEdit ? 'Edit name' : 'Add a name'}
	{impact}
	isLoading={isOpen && impact === null && previewError === null && isReady}
	isConfirming={submission.isSaving}
	error={submission.error ?? previewError}
	confirmLabel={isEdit ? 'Save name' : 'Add name'}
	idleMessage={hasContent
		? 'Fix the date to see what will change.'
		: 'Enter a name to see what will change.'}
	isConfirmBlocked={!isReady}
	onconfirm={save}
	{oncancel}
>
	{#snippet controls()}
		<form
			class="space-y-3"
			data-testid="name-form"
			onsubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<div>
				<label for="name-type" class="field-label">Type</label>
				<select id="name-type" bind:this={typeSelect} bind:value={type} class={field}>
					{#each NAME_TYPE_LIST as code (code)}<option value={code}>{NAME_TYPE_LABELS[code]}</option
						>{/each}
				</select>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="name-given" class="field-label">Given names</label>
					<input
						id="name-given"
						type="text"
						bind:value={givenName}
						class={field}
						placeholder="e.g. Jane Mary"
					/>
				</div>
				<div>
					<label for="name-surname" class="field-label">Surname</label>
					<input
						id="name-surname"
						type="text"
						bind:value={surname}
						class={field}
						placeholder="e.g. Smith"
					/>
				</div>
			</div>

			<div class="grid grid-cols-3 gap-3">
				<div>
					<label for="name-prefix" class="field-label">Prefix</label>
					<input id="name-prefix" type="text" bind:value={prefix} class={field} placeholder="Dr" />
				</div>
				<div>
					<label for="name-surname-prefix" class="field-label">Surname prefix</label>
					<input
						id="name-surname-prefix"
						type="text"
						bind:value={surnamePrefix}
						class={field}
						placeholder="de la"
					/>
				</div>
				<div>
					<label for="name-suffix" class="field-label">Suffix</label>
					<input id="name-suffix" type="text" bind:value={suffix} class={field} placeholder="Jr" />
				</div>
			</div>

			<div>
				<label for="name-nickname" class="field-label"
					>Nickname <span class="font-normal text-stone-500">(optional)</span></label
				>
				<input id="name-nickname" type="text" bind:value={nickname} class={field} />
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="name-date" class="field-label"
						>In use from <span class="font-normal text-stone-500">(optional)</span></label
					>
					<DateInput
						id="name-date"
						bind:value={dateText}
						savedValue={name?.dateText}
						inputClass={field}
					/>
				</div>
				<div>
					<label for="name-union" class="field-label"
						>Taken through <span class="font-normal text-stone-500">(optional)</span></label
					>
					<select id="name-union" bind:value={unionId} class={field}>
						<option value="">No partnership</option>
						{#each partnerships as partnership (partnership.unionId)}<option
								value={partnership.unionId}>{partnership.label}</option
							>{/each}
					</select>
				</div>
			</div>

			{#if !isEdit}
				<label class="flex items-center gap-2 text-sm text-stone-800">
					<input
						type="checkbox"
						bind:checked={isPreferred}
						class="h-4 w-4 rounded border-stone-300"
					/>
					Show this person by this name
				</label>
			{/if}

			<SourceSection
				{treeId}
				idPrefix="name-source"
				{role}
				{isOpen}
				existing={citations}
				onchange={(next) => (citation = next)}
				onerror={(message) => (submission.error = message)}
			/>
		</form>
	{/snippet}
</ImpactDialog>
