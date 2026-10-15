<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { Landmark } from '@lucide/svelte';
	import BaseModal from '#lib/components/modals/BaseModal.svelte';
	import { createSubmission } from '#lib/components/forms/submission.svelte.js';
	import {
		createRepositoryApi,
		fetchRepositories,
		linkRepositoryApi,
		updateSourceLinkApi
	} from '#lib/api/evidence.js';
	import type { RepositoryListItem, SourceRepositoryDto } from '#lib/shared/evidence.js';
	import type { ChangeSummary } from '#lib/types/genealogy.js';

	interface Props {
		isOpen: boolean;
		treeId: string;
		sourceId: string;
		/** The link whose call number is being changed, or null to say where the source is kept. */
		link: SourceRepositoryDto | null;
		onsaved: (change: ChangeSummary | null) => void | Promise<void>;
		onstale: (message: string) => void | Promise<void>;
		oncancel: () => void;
	}

	let { isOpen, treeId, sourceId, link, onsaved, onstale, oncancel }: Props = $props();

	let repositories = $state<RepositoryListItem[]>([]);
	let repositoryId = $state('');
	let isNew = $state(false);
	let newName = $state('');
	let callNumber = $state('');
	const submission = createSubmission((message) => onstale(message));
	let firstField = $state<HTMLInputElement | HTMLSelectElement | null>(null);
	let callField = $state<HTMLInputElement | null>(null);

	const field =
		'w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600';

	$effect(() => {
		if (!isOpen) return;
		const from = untrack(() => link);
		repositoryId = '';
		isNew = false;
		newName = '';
		callNumber = from?.callNumber ?? '';
		submission.error = null;
		if (!from) {
			void fetchRepositories(treeId, new URLSearchParams({ limit: '100' }))
				.then((page) => {
					repositories = page.items;
					isNew = page.items.length === 0;
				})
				.catch(() => (repositories = []));
		}
		void tick().then(() => (firstField ?? callField)?.focus());
	});

	async function save() {
		await submission.submit(async () => {
			if (link) {
				const { change } = await updateSourceLinkApi(
					treeId,
					link.linkId,
					callNumber.trim() || null,
					link.version
				);
				await onsaved(change);
				return;
			}
			let chosen = repositoryId;
			if (isNew) {
				if (!newName.trim()) {
					submission.error = 'Give the repository a name.';
					return;
				}
				chosen = (await createRepositoryApi(treeId, { name: newName.trim() })).repositoryId;
			}
			if (!chosen) {
				submission.error = 'Choose where the source is kept.';
				return;
			}
			const { change } = await linkRepositoryApi(treeId, sourceId, {
				repositoryId: chosen,
				callNumber: callNumber.trim() || null
			});
			await onsaved(change);
		}, 'Could not save');
	}
</script>

<BaseModal
	{isOpen}
	title={link ? 'Change the call number' : 'Where is this source kept?'}
	icon={Landmark}
	error={submission.error}
	onclose={oncancel}
>
	<form
		class="space-y-3"
		data-testid="repository-link-form"
		onsubmit={(event) => {
			event.preventDefault();
			void save();
		}}
	>
		{#if !link}
			{#if isNew}
				<div>
					<label for="link-new-repository" class="field-label">Name of the repository</label>
					<input
						id="link-new-repository"
						type="text"
						bind:this={firstField}
						bind:value={newName}
						class={field}
					/>
				</div>
				{#if repositories.length > 0}
					<button
						type="button"
						class="row-link text-xs font-semibold"
						onclick={() => (isNew = false)}>Choose an existing repository</button
					>
				{/if}
			{:else}
				<div>
					<label for="link-repository" class="field-label">Repository</label>
					<select
						id="link-repository"
						bind:this={firstField}
						bind:value={repositoryId}
						class={field}
					>
						<option value="">Choose…</option>
						{#each repositories as repository (repository.id)}
							<option value={repository.id}>{repository.name ?? 'Unnamed repository'}</option>
						{/each}
					</select>
				</div>
				<button type="button" class="row-link text-xs font-semibold" onclick={() => (isNew = true)}
					>Make a new repository…</button
				>
			{/if}
		{/if}
		<div>
			<label for="link-call-number" class="field-label"
				>Call number <span class="font-normal text-stone-500">(optional)</span></label
			>
			<input
				id="link-call-number"
				type="text"
				bind:this={callField}
				bind:value={callNumber}
				class={field}
			/>
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
				disabled={submission.isSaving}
				class="flex-1 cursor-pointer rounded-lg bg-emerald-800 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
				>{submission.isSaving ? 'Saving…' : 'Save'}</button
			>
		</div>
	</form>
</BaseModal>
