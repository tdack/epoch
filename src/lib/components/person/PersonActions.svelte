<script lang="ts">
	import { goto } from '$app/navigation';
	import { Combine, Cross, GitBranch, Pencil, Star, Trash2, UserPlus } from 'lucide-svelte';
	import PersonMergeDialog from '#lib/components/modals/PersonMergeDialog.svelte';
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import type { MarksStore } from '#lib/components/layout/marks-store.svelte.js';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import { setFavoriteApi, undoApi } from '#lib/services/tree-api.js';
	import { canChangeRecords, canCreateRecords, type TreeRole } from '#lib/shared/roles.js';
	import { canMergePerson } from './person-permissions.js';
	import type { PersonPageDto } from '#lib/shared/person-page.js';
	import { personPath, treePath } from './person-paths.js';
	import { LINK_TARGET, type RelativeTarget } from './relative-target.js';

	interface Props {
		dto: PersonPageDto;
		treeId: string;
		/** The viewer's role in this tree; merging deletes a record, so it needs an editor. */
		role: TreeRole | undefined;
		editor: TreeEditor;
		toasts: ToastStore;
		marks: MarksStore;
		/** Where a merge leaves the viewer: the survivor's page, or the survivor selected in place. */
		relativeTarget?: RelativeTarget;
	}

	let { dto, treeId, role, editor, toasts, marks, relativeTarget = LINK_TARGET }: Props = $props();

	const treeHref = $derived(treePath(treeId));
	const here = $derived(personPath(treeId, dto.person.id));

	const isFavorite = $derived(marks.favorites.some((f) => f.id === dto.person.id));

	async function toggleFavorite() {
		try {
			marks.set(await setFavoriteApi(treeId, dto.person.id, !isFavorite));
		} catch (cause) {
			toasts.push((cause as Error).message || 'Could not change the favourite', { tone: 'error' });
		}
	}

	const canMerge = $derived(canMergePerson(role));
	const canAdd = $derived(canCreateRecords(role));
	const canChange = $derived(canChangeRecords(role));
	let isMerging = $state(false);

	async function showPerson(id: string) {
		if (relativeTarget.kind === 'select') {
			// The survivor may already be the focus, in which case selecting it reloads nothing.
			relativeTarget.onSelect(id);
			await editor.refresh();
		} else await goto(personPath(treeId, id), { refreshAll: true });
	}

	// The record that goes may be the one on screen, so the view moves to the one that stays, and Undo moves back.
	async function merged(change: Parameters<typeof editor.afterChange>[0], survivorId: string) {
		const hereId = dto.person.id;
		isMerging = false;
		await showPerson(survivorId);
		toasts.push(change?.summary ?? 'People merged', {
			action: change?.isUndoable
				? {
						label: 'Undo',
						run: async () => {
							try {
								const { undone } = await undoApi(treeId);
								await showPerson(hereId);
								toasts.push(`Undid: ${undone.summary}`);
							} catch (cause: unknown) {
								toasts.push((cause as Error).message || 'Could not undo', {
									tone: 'error',
									durationMs: 10_000
								});
							}
						}
					}
				: undefined
		});
	}
</script>

<div class="space-y-2">
	<div class="flex flex-wrap gap-2">
		<button
			type="button"
			onclick={toggleFavorite}
			aria-pressed={isFavorite}
			class="action-btn"
			data-testid="favorite-toggle"
		>
			<Star class="h-3.5 w-3.5 {isFavorite ? 'fill-amber-400 text-amber-500' : ''}" />{isFavorite
				? 'Favourite'
				: 'Add to favourites'}
		</button>
		{#if canChange}<button
				type="button"
				onclick={() => void editor.openEditPerson(dto.person.id)}
				class="action-btn"><Pencil class="h-3.5 w-3.5" />Edit</button
			>{/if}
		{#if canAdd}<button
				type="button"
				onclick={() => editor.openRelationship(editor.anchorFor(dto.person.id))}
				class="action-btn"><UserPlus class="h-3.5 w-3.5" />Relationship</button
			>{/if}
		{#if canChange}<button
				type="button"
				onclick={() =>
					editor.openRelationship(editor.anchorFor(dto.person.id), { kind: 'record_death' })}
				class="action-btn"><Cross class="h-3.5 w-3.5" />Record death</button
			>{/if}
		{#if canMerge}
			<button
				type="button"
				onclick={() => (isMerging = true)}
				class="action-btn"
				data-testid="merge-person"><Combine class="h-3.5 w-3.5" />Merge…</button
			>
		{/if}
		{#if canChange}<button
				type="button"
				onclick={() => editor.requestDeletePerson(dto.person.id)}
				class="action-btn text-red-700"><Trash2 class="h-3.5 w-3.5" />Delete…</button
			>{/if}
	</div>
	<p class="text-xs">
		<a
			href={`${treeHref}?focus=${encodeURIComponent(dto.person.id)}`}
			class="text-link inline-flex items-center gap-1"
			><GitBranch class="h-3 w-3" />Show in the tree</a
		> <span aria-hidden="true">·</span>
		<a href={`${here}/pedigree`} class="text-link">Ancestors</a>
		<span aria-hidden="true">·</span>
		<a href={`${here}/descendants`} class="text-link">Descendants</a>
		<span aria-hidden="true">·</span>
		<a href={`${here}/fan`} class="text-link">Fan</a> <span aria-hidden="true">·</span>
		<a href={`${here}/hourglass`} class="text-link">Hourglass</a>
		<span aria-hidden="true">·</span>
		<a href={`${treeHref}/relationship?from=${encodeURIComponent(dto.person.id)}`} class="text-link"
			>Relationship to…</a
		>
	</p>
</div>

{#if canMerge}
	<PersonMergeDialog
		isOpen={isMerging}
		{treeId}
		person={{ id: dto.person.id, name: dto.person.displayName }}
		onmerged={merged}
		oncancel={() => (isMerging = false)}
	/>
{/if}
