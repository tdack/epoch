<script lang="ts">
	import { UserPlus, Pencil, RefreshCw } from 'lucide-svelte';
	import BaseModal from './BaseModal.svelte';
	import DateInput from '#lib/components/forms/DateInput.svelte';
	import { checkDateText } from '#lib/shared/date-value.js';
	import { SEX_LABELS, SEX_VALUES, type Sex } from '#lib/shared/sex.js';
	import type { PersonFormData } from '#lib/types/genealogy.js';

	interface Props {
		isOpen: boolean;
		mode: 'add' | 'edit';
		initialPerson?: any | null;
		isSubmitting?: boolean;
		error?: string | null;
		onclose: () => void;
		onsubmit: (data: PersonFormData) => void;
	}

	let {
		isOpen,
		mode,
		initialPerson = null,
		isSubmitting = false,
		error = null,
		onclose,
		onsubmit
	}: Props = $props();

	let givenName = $state('');
	let surname = $state('');
	let sex = $state<Sex>('U');
	let birthDate = $state('');
	let birthPlace = $state('');
	let deathDate = $state('');
	let deathPlace = $state('');
	let localError = $state<string | null>(null);

	$effect(() => {
		if (isOpen) {
			if (!checkDateText(birthDate).isValid || !checkDateText(deathDate).isValid) {
				localError = 'Fix the highlighted date before saving.';
				return;
			}
			localError = null;
			if (mode === 'edit' && initialPerson) {
				const raw = initialPerson.raw || {};
				givenName = raw.givenName || '';
				surname = raw.surname || '';
				sex = (initialPerson.sex as Sex) || raw.sex || 'U';

				const events = raw.events || [];
				const birthEvent = events.find((e: any) => e.type === 'BIRT');
				const deathEvent = events.find((e: any) => e.type === 'DEAT');

				birthDate = birthEvent?.dateRaw || '';
				birthPlace = birthEvent?.place || '';
				deathDate = deathEvent?.dateRaw || '';
				deathPlace = deathEvent?.place || '';
			} else {
				givenName = '';
				surname = '';
				sex = 'U';
				birthDate = '';
				birthPlace = '';
				deathDate = '';
				deathPlace = '';
			}
		}
	});

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!givenName.trim() && !surname.trim()) {
			localError = 'Please provide at least a given name or surname.';
			return;
		}
		localError = null;

		onsubmit({
			givenName: givenName.trim() || (mode === 'edit' ? null : undefined),
			surname: surname.trim() || (mode === 'edit' ? null : undefined),
			sex,
			birthDate: birthDate.trim() || (mode === 'edit' ? null : undefined),
			birthPlace: birthPlace.trim() || (mode === 'edit' ? null : undefined),
			deathDate: deathDate.trim() || (mode === 'edit' ? null : undefined),
			deathPlace: deathPlace.trim() || (mode === 'edit' ? null : undefined)
		});
	}
</script>

<BaseModal
	{isOpen}
	title={mode === 'edit' ? 'Edit Person Details' : 'Add Individual'}
	icon={mode === 'edit' ? Pencil : UserPlus}
	iconBgClass="bg-emerald-100"
	iconBorderClass="border-emerald-300"
	iconTextClass="text-emerald-800"
	maxWidthClass={mode === 'edit' ? 'max-w-md' : 'max-w-lg'}
	error={error || localError}
	{onclose}
>
	<form onsubmit={handleSubmit} class="space-y-4">
		{#if mode === 'edit' && initialPerson?.notice}
			<p
				class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
				data-testid="person-form-notice"
			>
				{initialPerson.notice}
			</p>
		{/if}
		<div class="space-y-4">
			<!-- Names -->
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label
						for="person-given-name-field"
						class="mb-1 block text-xs font-semibold text-stone-700">Given Names</label
					>
					<input
						id="person-given-name-field"
						type="text"
						bind:value={givenName}
						placeholder={mode === 'edit' ? 'e.g. John' : 'e.g. John Edward'}
						disabled={isSubmitting}
						class="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 focus:outline-none disabled:opacity-50"
					/>
				</div>
				<div>
					<label for="person-surname-field" class="mb-1 block text-xs font-semibold text-stone-700"
						>Surname</label
					>
					<input
						id="person-surname-field"
						type="text"
						bind:value={surname}
						placeholder="e.g. Smith"
						disabled={isSubmitting}
						class="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 focus:outline-none disabled:opacity-50"
					/>
				</div>
			</div>

			<!-- Sex -->
			<div>
				<span class="mb-1.5 block text-xs font-semibold text-stone-700">Sex</span>
				<div class="flex items-center space-x-4">
					{#each SEX_VALUES as option (option)}
						<label class="inline-flex cursor-pointer items-center text-xs text-stone-700">
							<input
								type="radio"
								name="person-form-sex"
								value={option}
								bind:group={sex}
								disabled={isSubmitting}
								class="mr-1.5 text-emerald-800 focus:ring-emerald-600"
							/>
							{SEX_LABELS[option]}
						</label>
					{/each}
				</div>
			</div>

			<!-- Birth Event -->
			<div class="border-t border-stone-200 pt-3">
				<h4 class="mb-2 text-xs font-bold tracking-wider text-stone-600 uppercase">Birth Event</h4>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label
							for="person-birth-date-field"
							class="mb-1 block text-xs font-medium text-stone-600">Birth Date</label
						>
						<DateInput
							id="person-birth-date-field"
							bind:value={birthDate}
							isDisabled={isSubmitting}
							inputClass="bg-stone-50 border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:opacity-50"
						/>
					</div>
					<div>
						<label
							for="person-birth-place-field"
							class="mb-1 block text-xs font-medium text-stone-600">Birth Place</label
						>
						<input
							id="person-birth-place-field"
							type="text"
							bind:value={birthPlace}
							placeholder="e.g. Southampton, England"
							disabled={isSubmitting}
							class="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 focus:outline-none disabled:opacity-50"
						/>
					</div>
				</div>
			</div>

			<!-- Death Event -->
			<div class="border-t border-stone-200 pt-3">
				<h4 class="mb-2 text-xs font-bold tracking-wider text-stone-600 uppercase">Death Event</h4>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label
							for="person-death-date-field"
							class="mb-1 block text-xs font-medium text-stone-600">Death Date</label
						>
						<DateInput
							id="person-death-date-field"
							bind:value={deathDate}
							isDisabled={isSubmitting}
							inputClass="bg-stone-50 border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:opacity-50"
						/>
					</div>
					<div>
						<label
							for="person-death-place-field"
							class="mb-1 block text-xs font-medium text-stone-600">Death Place</label
						>
						<input
							id="person-death-place-field"
							type="text"
							bind:value={deathPlace}
							placeholder="e.g. New York, USA"
							disabled={isSubmitting}
							class="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 focus:outline-none disabled:opacity-50"
						/>
					</div>
				</div>
			</div>
		</div>

		<div class="flex justify-end space-x-2 border-t border-stone-200 pt-3">
			<button
				type="button"
				onclick={onclose}
				disabled={isSubmitting}
				class="cursor-pointer rounded-lg px-4 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-200/60 hover:text-stone-900 disabled:opacity-50"
			>
				Cancel
			</button>
			<button
				type="submit"
				disabled={isSubmitting}
				class="inline-flex cursor-pointer items-center space-x-1.5 rounded-lg bg-emerald-800 px-4 py-2 text-xs font-semibold text-amber-50 shadow-xs transition-colors hover:bg-emerald-700 disabled:opacity-50"
			>
				{#if isSubmitting}
					<RefreshCw class="mr-1 h-3.5 w-3.5 animate-spin" />
					<span>Saving...</span>
				{:else}
					<span>{mode === 'edit' ? 'Save Changes' : 'Add Person'}</span>
				{/if}
			</button>
		</div>
	</form>
</BaseModal>
