<script lang="ts">
	import { GitCompare } from 'lucide-svelte';
	import BaseModal from './BaseModal.svelte';
	import type { ConflictRow } from './conflict.js';

	interface Props {
		/** Whether the dialog is open. */
		show: boolean;
		/** What was being edited, e.g. "Homer Simpson". */
		subject: string;
		/** Only the fields that differ; identical fields are left out. */
		rows: ConflictRow[];
		/** True while re-applying. */
		isWorking?: boolean;
		/** Reload the stored values into the form, dropping the edit. */
		onreload: () => void;
		/** Save the edit again on top of the stored values. Omitted when re-applying would be unsafe. */
		onreapply?: () => void;
		oncancel: () => void;
	}

	let { show, subject, rows, isWorking = false, onreload, onreapply, oncancel }: Props = $props();
</script>

<BaseModal
	{show}
	title="Someone else changed this"
	subtitle={subject}
	icon={GitCompare}
	iconBgClass="bg-amber-100"
	iconBorderClass="border-amber-300"
	iconTextClass="text-amber-800"
	maxWidthClass="max-w-xl"
	onclose={oncancel}
>
	<div class="space-y-3">
		<p class="text-sm text-stone-700">
			This record was saved by someone else after you opened it. Nothing of yours has been saved.
			{#if rows.length > 0}Here is how the two versions differ:{/if}
		</p>

		{#if rows.length > 0}
			<table class="w-full text-left text-sm">
				<thead>
					<tr class="text-xs tracking-wide text-stone-500 uppercase">
						<th scope="col" class="py-1 pr-3 font-semibold">Field</th>
						<th scope="col" class="py-1 pr-3 font-semibold">Your value</th>
						<th scope="col" class="py-1 font-semibold">Saved now</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.label)}
						<tr class="border-t border-stone-200 align-top">
							<th scope="row" class="py-1.5 pr-3 font-medium text-stone-800">{row.label}</th>
							<td class="py-1.5 pr-3 text-emerald-900">{row.yours || '(empty)'}</td>
							<td class="py-1.5 text-red-900">{row.current || '(empty)'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<p class="text-sm text-stone-600">
				The values you entered match what is saved; only its version moved on.
			</p>
		{/if}

		<div class="flex flex-wrap gap-2 pt-1">
			<button
				type="button"
				onclick={oncancel}
				class="cursor-pointer rounded-lg bg-stone-200 px-4 py-2 font-semibold text-stone-700 hover:bg-stone-300"
			>
				Keep editing
			</button>
			<button
				type="button"
				onclick={onreload}
				class="flex-1 cursor-pointer rounded-lg border border-stone-300 bg-white py-2 font-semibold text-stone-800 hover:bg-stone-100"
			>
				Reload saved values
			</button>
			{#if onreapply}
				<button
					type="button"
					onclick={onreapply}
					disabled={isWorking}
					class="flex-1 cursor-pointer rounded-lg bg-emerald-700 py-2 font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
				>
					{isWorking ? 'Saving…' : 'Re-apply my changes'}
				</button>
			{/if}
		</div>
	</div>
</BaseModal>
