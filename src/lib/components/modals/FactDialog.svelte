<script lang="ts">
	import { tick, untrack } from 'svelte';
	import ImpactDialog from './ImpactDialog.svelte';
	import DateInput from '#lib/components/forms/DateInput.svelte';
	import { checkDateEdit } from '#lib/shared/date-value.js';
	import {
		FACT_KINDS,
		FACT_TYPE_LIST,
		factTypeInfo,
		type FactInput
	} from '#lib/shared/fact-types.js';
	import type { FactDto } from '#lib/shared/person-page.js';
	import {
		createFactApi,
		isConflict,
		previewFactApi,
		suggestPlacesApi,
		updateFactApi
	} from '#lib/services/tree-api.js';
	import type { ChangeSummary, ImpactSummary } from '#lib/types/genealogy.js';

	interface Props {
		isOpen: boolean;
		treeId: string;
		personId: string;
		/** The fact being edited, or null to add one. */
		fact: FactDto | null;
		/** Called after a save, with the change so the caller can offer Undo. */
		onsaved: (change: ChangeSummary | null) => void | Promise<void>;
		/** Called when the fact changed under the person; the caller reloads and reopens with what is stored. */
		onstale: (message: string) => void | Promise<void>;
		oncancel: () => void;
	}

	let { isOpen, treeId, personId, fact, onsaved, onstale, oncancel }: Props = $props();

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

	let impact = $state<ImpactSummary | null>(null);
	let previewError = $state<string | null>(null);
	let saveError = $state<string | null>(null);
	let isSaving = $state(false);
	let typeSelect = $state<HTMLSelectElement | null>(null);
	let previewRequest = 0;
	// Places already on the tree's facts, offered as the user types so one place keeps one spelling.
	// A suggestion fills in the text only; what is saved is whatever the field holds.
	let placeOptions = $state<string[]>([]);
	$effect(() => {
		const typed = place.trim();
		if (!isOpen || typed.length < 2) {
			placeOptions = [];
			return;
		}
		const timer = setTimeout(async () => {
			try {
				placeOptions = await suggestPlacesApi(treeId, typed);
			} catch {
				placeOptions = [];
			}
		}, PREVIEW_DELAY_MS);
		return () => clearTimeout(timer);
	});

	const isEdit = $derived(fact !== null);
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
		impact = null;
		previewError = null;
		saveError = null;
		void tick().then(() => typeSelect?.focus());
	});

	// What the save would write, refreshed as the form changes. Planned on the server, so the list is
	// the same operations the save runs.
	$effect(() => {
		if (!isOpen) return;
		const input = toInput();
		const isValid = isDateValid;
		const source = untrack(() => fact);
		const timer = setTimeout(async () => {
			const request = ++previewRequest;
			if (!isValid) {
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
					: await previewFactApi(treeId, { kind: 'create_fact', personId, fact: input });
				if (request !== previewRequest) return;
				impact = next;
				previewError = null;
			} catch (cause: unknown) {
				if (request !== previewRequest) return;
				impact = null;
				previewError = (cause as Error).message;
			}
		}, PREVIEW_DELAY_MS);
		return () => clearTimeout(timer);
	});

	async function save() {
		if (!isDateValid) {
			saveError = 'Fix the highlighted date before saving.';
			return;
		}
		isSaving = true;
		saveError = null;
		try {
			const input = toInput();
			const { change } = fact
				? await updateFactApi(treeId, fact.id, input, fact.version)
				: await createFactApi(treeId, personId, input);
			await onsaved(change);
		} catch (cause: unknown) {
			if (isConflict(cause)) await onstale(cause.message);
			else saveError = (cause as Error).message || 'Could not save the fact';
		} finally {
			isSaving = false;
		}
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
	isConfirming={isSaving}
	error={saveError ?? previewError}
	confirmLabel={isEdit ? 'Save fact' : 'Add fact'}
	idleMessage="Fix the date to see what will change."
	isConfirmBlocked={!isDateValid}
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
					<input
						id="fact-place"
						type="text"
						bind:value={place}
						list="fact-place-options"
						autocomplete="off"
						class={field}
						placeholder="e.g. Leeds, Yorkshire"
					/>
					<datalist id="fact-place-options"
						>{#each placeOptions as option (option)}<option value={option}
							></option>{/each}</datalist
					>
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
		</form>
	{/snippet}
</ImpactDialog>
