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
		FACT_KINDS,
		FACT_TYPE_LIST,
		factTypeInfo,
		type FactInput,
		type FactRelative
	} from '#lib/shared/fact-types.js';
	import type { FactDto } from '#lib/shared/person-page.js';
	import PlaceInput from '#lib/components/forms/PlaceInput.svelte';
	import {
		createFactApi,
		createGroupFactApi,
		previewFactApi,
		updateFactApi
	} from '#lib/api/people.js';
	import type { ChangeSummary, ImpactSummary } from '#lib/types/genealogy.js';

	interface Props {
		isOpen: boolean;
		treeId: string;
		/** Who the fact is for; null when it is added only to the people ticked in `relatives`. */
		personId: string | null;
		/** The fact being edited, or null to add one. */
		fact: FactDto | null;
		/** The viewer's role; the optional Source section is shown only to a role that can cite. */
		role: TreeRole | undefined;
		/** The fact's existing citations, listed in the Source section when editing. */
		citations?: CitationDto[];
		/** When adding: people the same fact can also be added to, as separate copies (ADR-071). */
		relatives?: FactRelative[];
		/** The `relatives` ticked when the dialog opens. */
		preTickedIds?: string[];
		/** Called after a save, with the change so the caller can offer Undo. */
		onsaved: (change: ChangeSummary | null) => void | Promise<void>;
		/** Called when the fact changed under the person; the caller reloads and reopens with what is stored. */
		onstale: (message: string) => void | Promise<void>;
		oncancel: () => void;
	}

	let {
		isOpen,
		treeId,
		personId,
		fact,
		role,
		citations = [],
		relatives = [],
		preTickedIds = [],
		onsaved,
		onstale,
		oncancel
	}: Props = $props();

	const PREVIEW_DELAY_MS = 250;
	const EVENT_TYPES = FACT_TYPE_LIST.filter((t) => t.kind === FACT_KINDS.EVENT);
	const ATTRIBUTE_TYPES = FACT_TYPE_LIST.filter((t) => t.kind === FACT_KINDS.ATTRIBUTE);

	let type = $state('EVEN');
	let dateText = $state('');
	let place = $state('');
	let value = $state('');
	let cause = $state('');
	let age = $state('');
	let notes = $state('');
	let address = $state('');
	let classification = $state('');
	let agency = $state('');
	let religion = $state('');
	let phone = $state('');
	let email = $state('');
	let fax = $state('');
	let web = $state('');
	let latitude = $state('');
	let longitude = $state('');
	let isDetailsOpen = $state(false);
	let citation = $state<CitationInput | null>(null);
	let tickedIds = $state<string[]>([]);

	let impact = $state<ImpactSummary | null>(null);
	let previewError = $state<string | null>(null);
	const submission = createSubmission((message) => onstale(message));
	let typeSelect = $state<HTMLSelectElement | null>(null);
	let previewRequest = 0;
	const isEdit = $derived(fact !== null);
	const targetIds = $derived(personId === null ? tickedIds : [personId, ...tickedIds]);
	const isGroup = $derived(!isEdit && (personId === null || tickedIds.length > 0));
	const isAttribute = $derived(factTypeInfo(type)?.kind === FACT_KINDS.ATTRIBUTE);
	const isDateValid = $derived(checkDateEdit(dateText, fact?.dateText).isValid);
	const field =
		'w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600';

	const isPlaceless = $derived(place.trim() === '');
	const hasSubTypeOutsideDetails = $derived(type === 'EVEN' || type === 'FACT');

	/** Trimmed, or null when empty; the server compares against the stored value and keeps it if equal. */
	const orNull = (text: string) => text.trim() || null;

	const toInput = (): FactInput => ({
		type,
		dateText: orNull(dateText),
		place: orNull(place),
		value: orNull(value),
		cause: orNull(cause),
		age: orNull(age),
		notes: orNull(notes),
		address: orNull(address),
		classification: orNull(classification),
		agency: orNull(agency),
		religion: orNull(religion),
		phone: orNull(phone),
		email: orNull(email),
		fax: orNull(fax),
		web: orNull(web),
		latitude: orNull(latitude),
		longitude: orNull(longitude)
	});

	/** Whether a stored fact has any of the details, so the Details section starts open. */
	const hasAnyDetail = (source: FactDto | null) =>
		source !== null &&
		[
			source.address,
			source.classification,
			source.agency,
			source.religion,
			source.phone,
			source.email,
			source.fax,
			source.web,
			source.latitude,
			source.longitude
		].some((detail) => detail !== null && detail.trim() !== '');

	// Fill the form only when the dialog opens: reading `fact` inside the effect that also watches the
	// fields would wipe what has been typed whenever the page data reloads underneath it.
	$effect(() => {
		if (!isOpen) return;
		const source = untrack(() => fact);
		type = source?.type ?? 'OCCU';
		dateText = source?.dateText ?? '';
		place = source?.place ?? '';
		value = source?.value ?? '';
		cause = source?.cause ?? '';
		age = source?.age ?? '';
		notes = source?.notes ?? '';
		address = source?.address ?? '';
		classification = source?.classification ?? '';
		agency = source?.agency ?? '';
		religion = source?.religion ?? '';
		phone = source?.phone ?? '';
		email = source?.email ?? '';
		fax = source?.fax ?? '';
		web = source?.web ?? '';
		latitude = source?.latitude ?? '';
		longitude = source?.longitude ?? '';
		isDetailsOpen = hasAnyDetail(source);
		tickedIds = untrack(() => [...preTickedIds]);
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
		const isValid = isDateValid;
		const targets = targetIds;
		const isMany = isGroup;
		const source = untrack(() => fact);
		const timer = setTimeout(async () => {
			const request = ++previewRequest;
			if (!isValid || (!source && targets.length === 0)) {
				impact = null;
				return;
			}
			try {
				const next = source
					? await previewFactApi(treeId, {
							kind: 'update_fact',
							factId: source.id,
							version: source.version,
							fact: input
						})
					: isMany
						? await previewFactApi(treeId, {
								kind: 'create_group_fact',
								personIds: targets,
								fact: input
							})
						: await previewFactApi(treeId, {
								kind: 'create_fact',
								personId: targets[0],
								fact: input
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
		if (!isDateValid) {
			submission.error = 'Fix the highlighted date before saving.';
			return;
		}
		if (!isEdit && targetIds.length === 0) {
			submission.error = 'Choose at least one person.';
			return;
		}
		await submission.submit(async () => {
			const input = toInput();
			const { change } = fact
				? await updateFactApi(treeId, fact.id, input, fact.version, citation)
				: isGroup
					? await createGroupFactApi(treeId, targetIds, input, citation)
					: await createFactApi(treeId, targetIds[0], input, citation);
			await onsaved(change);
		}, 'Could not save the fact');
	}
</script>

{#snippet subType()}
	<div>
		<label for="fact-classification" class="field-label">Sub-type</label>
		<input
			id="fact-classification"
			type="text"
			bind:value={classification}
			class={field}
			placeholder="e.g. Baptism at home"
		/>
	</div>
{/snippet}

<ImpactDialog
	{isOpen}
	title={isEdit ? 'Edit fact' : 'Add a fact'}
	{impact}
	isLoading={isOpen && impact === null && previewError === null && isDateValid}
	isConfirming={submission.isSaving}
	error={submission.error ?? previewError}
	confirmLabel={isEdit ? 'Save fact' : isGroup ? `Add to ${targetIds.length}` : 'Add fact'}
	idleMessage="Fix the date to see what will change."
	isConfirmBlocked={!isDateValid || (!isEdit && targetIds.length === 0)}
	onconfirm={save}
	{oncancel}
>
	{#snippet controls()}
		<form
			class="space-y-3"
			data-testid="fact-form"
			onsubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<div>
				<label for="fact-type" class="field-label">Type</label>
				<select id="fact-type" bind:this={typeSelect} bind:value={type} class={field}>
					<optgroup label="Events">
						{#each EVENT_TYPES as info (info.code)}<option value={info.code}>{info.label}</option
							>{/each}
					</optgroup>
					<optgroup label="Attributes">
						{#each ATTRIBUTE_TYPES as info (info.code)}<option value={info.code}
								>{info.label}</option
							>{/each}
					</optgroup>
				</select>
			</div>

			{#if hasSubTypeOutsideDetails}
				{@render subType()}
			{/if}

			{#if isAttribute}
				<div>
					<label for="fact-value" class="field-label">Value</label>
					<input
						id="fact-value"
						type="text"
						bind:value
						class={field}
						placeholder="e.g. Carpenter"
					/>
				</div>
			{/if}

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="fact-date" class="field-label">Date</label>
					<DateInput
						id="fact-date"
						bind:value={dateText}
						savedValue={fact?.dateText}
						inputClass={field}
					/>
				</div>
				<div>
					<label for="fact-place" class="field-label">Place</label>
					<PlaceInput
						id="fact-place"
						{treeId}
						bind:value={place}
						inputClass={field}
						placeholder="e.g. Leeds, Yorkshire"
					/>
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="fact-cause" class="field-label">Cause</label>
					<input id="fact-cause" type="text" bind:value={cause} class={field} />
				</div>
				<div>
					<label for="fact-age" class="field-label">Age</label>
					<input id="fact-age" type="text" bind:value={age} class={field} placeholder="e.g. 79y" />
				</div>
			</div>

			{#if !isAttribute}
				<div>
					<label for="fact-value-event" class="field-label"
						>Value <span class="font-normal text-stone-500">(optional)</span></label
					>
					<input id="fact-value-event" type="text" bind:value class={field} />
				</div>
			{/if}

			<details
				class="rounded-lg border border-stone-200 px-3 py-2"
				bind:open={isDetailsOpen}
				data-testid="fact-details"
			>
				<summary class="cursor-pointer text-sm font-semibold text-emerald-900">Details</summary>
				<div class="mt-3 space-y-3">
					{#if !hasSubTypeOutsideDetails}
						{@render subType()}
					{/if}

					<div>
						<label for="fact-address" class="field-label">Address</label>
						<textarea id="fact-address" rows="3" bind:value={address} class={field}></textarea>
					</div>

					<div>
						<label for="fact-agency" class="field-label">Agency</label>
						<input id="fact-agency" type="text" bind:value={agency} class={field} />
					</div>

					{#if type !== 'RELI'}
						<div>
							<label for="fact-religion" class="field-label">Religion</label>
							<input id="fact-religion" type="text" bind:value={religion} class={field} />
						</div>
					{/if}

					<div>
						<label for="fact-phone" class="field-label">Phone</label>
						<textarea
							id="fact-phone"
							rows="2"
							bind:value={phone}
							class={field}
							aria-describedby="fact-contact-hint"></textarea>
					</div>
					<div>
						<label for="fact-email" class="field-label">Email</label>
						<textarea
							id="fact-email"
							rows="2"
							bind:value={email}
							class={field}
							aria-describedby="fact-contact-hint"></textarea>
					</div>
					<div>
						<label for="fact-fax" class="field-label">Fax</label>
						<textarea
							id="fact-fax"
							rows="2"
							bind:value={fax}
							class={field}
							aria-describedby="fact-contact-hint"></textarea>
					</div>
					<div>
						<label for="fact-web" class="field-label">Website</label>
						<textarea
							id="fact-web"
							rows="2"
							bind:value={web}
							class={field}
							aria-describedby="fact-contact-hint"></textarea>
					</div>
					<p id="fact-contact-hint" class="text-xs text-stone-500">One per line.</p>

					<div class="grid grid-cols-2 gap-3">
						<div>
							<label for="fact-latitude" class="field-label">Latitude</label>
							<input
								id="fact-latitude"
								type="text"
								bind:value={latitude}
								disabled={isPlaceless}
								class={field}
								aria-describedby="fact-coordinates-hint"
							/>
						</div>
						<div>
							<label for="fact-longitude" class="field-label">Longitude</label>
							<input
								id="fact-longitude"
								type="text"
								bind:value={longitude}
								disabled={isPlaceless}
								class={field}
								aria-describedby="fact-coordinates-hint"
							/>
						</div>
					</div>
					<p id="fact-coordinates-hint" class="text-xs text-stone-500">
						{#if isPlaceless}
							Add a place to record coordinates; they are stored with it.
						{:else}
							e.g. N18.150944 / E168.150944
						{/if}
					</p>
				</div>
			</details>

			<div>
				<label for="fact-notes" class="field-label">Notes</label>
				<textarea id="fact-notes" rows="2" bind:value={notes} class={field}></textarea>
			</div>

			{#if !isEdit && relatives.length > 0}
				<fieldset class="rounded-lg border border-stone-200 px-3 py-2" data-testid="fact-also-add">
					<legend class="px-1 text-sm font-semibold text-emerald-900">Also add to…</legend>
					<p class="text-xs text-stone-600">
						Each person gets their own copy. Editing one later does not change the others.
					</p>
					<ul class="mt-2 max-h-40 space-y-1 overflow-y-auto">
						{#each relatives as relative (relative.id)}
							<li>
								<label class="flex items-center gap-2 text-sm coarse:min-h-11">
									<input type="checkbox" value={relative.id} bind:group={tickedIds} />
									{relative.name}
									<span class="text-xs text-stone-500">{relative.relation}</span>
								</label>
							</li>
						{/each}
					</ul>
				</fieldset>
			{/if}

			<SourceSection
				{treeId}
				idPrefix="fact-source"
				{role}
				{isOpen}
				existing={citations}
				onchange={(next) => (citation = next)}
				onerror={(message) => (submission.error = message)}
			/>
		</form>
	{/snippet}
</ImpactDialog>
