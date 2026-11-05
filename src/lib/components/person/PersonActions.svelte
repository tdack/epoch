<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import { Combine, Cross, Ellipsis, Network, Trash2, User, UserPlus } from '@lucide/svelte';
	import Popover from '#lib/components/layout/Popover.svelte';
	import PersonMergeDialog from '#lib/components/modals/PersonMergeDialog.svelte';
	import SubtreeDialog from '#lib/components/subtree/SubtreeDialog.svelte';
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import type { MarksStore } from '#lib/components/layout/marks-store.svelte.js';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import { saveSelfPerson } from '#lib/api/settings.js';
	import { undoApi } from '#lib/api/relationships.js';
	import { createSubtree } from '#lib/api/subtrees.js';
	import { subtreePath } from '#lib/shared/tree-slug.js';
	import { DATA_KEY } from '#lib/shared/data-key.js';
	import {
		canChangeRecords,
		canCreateRecords,
		isManagerOrAbove,
		type TreeRole
	} from '#lib/shared/roles.js';
	import { canMergePerson } from './person-permissions.js';
	import type { PersonPageDto } from '#lib/shared/person-page.js';
	import { personPath } from './person-paths.js';
	import { LINK_TARGET, type RelativeTarget } from './relative-target.js';

	interface Props {
		dto: PersonPageDto;
		treeId: string;
		/** The tree's slug, for the links this builds (ADR-045); without one they use the id. */
		treeSlug?: string | null;
		/** The viewer's role in this tree; merging deletes a record, so it needs an editor. */
		role: TreeRole | undefined;
		/** The member's own person in this tree; private to them. */
		selfPersonId?: string | null;
		editor: TreeEditor;
		toasts: ToastStore;
		marks: MarksStore;
		/** Where a merge leaves the viewer: the survivor's page, or the survivor selected in place. */
		relativeTarget?: RelativeTarget;
	}

	let {
		dto,
		treeId,
		treeSlug = null,
		role,
		selfPersonId = null,
		editor,
		toasts,
		marks,
		relativeTarget = LINK_TARGET
	}: Props = $props();
	const treeRef = $derived({ id: treeId, slug: treeSlug });

	const isMe = $derived(selfPersonId === dto.person.id);

	async function toggleMe() {
		try {
			await saveSelfPerson(treeId, isMe ? null : dto.person.id);
			// The tree list carries it, and the layout loads that.
			await invalidate(DATA_KEY);
		} catch (cause) {
			toasts.push(messageOf(cause, 'Could not save who you are'), { tone: 'error' });
		}
	}

	const canMerge = $derived(canMergePerson(role));
	const canAdd = $derived(canCreateRecords(role));
	const canChange = $derived(canChangeRecords(role));
	let isMerging = $state(false);

	// `tree:manage_subtrees` is manager and above; the server still decides.
	const canMakeSubtree = $derived(isManagerOrAbove(role));
	let isMakingSubtree = $state(false);
	const hasMore = $derived(!marks.isReadOnly || canMerge || canMakeSubtree || canChange);
	const menuItem =
		'menu-item flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs font-medium coarse:min-h-11';
	let isSavingSubtree = $state(false);
	let subtreeError = $state<string | null>(null);
	const subtreeSuggestion = $derived.by(() => {
		const name = dto.names.find((n) => n.isPreferred) ?? dto.names[0];
		return name?.surname ? `${name.surname} line` : `${dto.person.displayName} line`;
	});

	async function makeSubtree(name: string, slug: string) {
		isSavingSubtree = true;
		subtreeError = null;
		try {
			await createSubtree(treeId, { name, slug, rootPersonId: dto.person.id });
			isMakingSubtree = false;
			// The summary lists the sub-tree, so the switcher needs the layout reloaded.
			await invalidate(DATA_KEY);
			await goto(subtreePath(treeRef, slug));
		} catch (cause) {
			subtreeError = messageOf(cause, 'Could not make the sub-tree');
		} finally {
			isSavingSubtree = false;
		}
	}

	async function showPerson(id: string) {
		if (relativeTarget.kind === 'select') {
			// The survivor may already be the focus, in which case selecting it reloads nothing.
			relativeTarget.onSelect(id);
			await editor.refresh();
		} else await goto(personPath(treeRef, id), { refreshAll: true });
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
								toasts.push(messageOf(cause, 'Could not undo'), {
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

<div class="flex flex-wrap gap-2">
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
	<!-- Rarer actions wait behind More, so the everyday ones keep to one row beside the name. -->
	{#if hasMore}
		<Popover label="More actions" align="end" panelClass="w-56 py-1">
			{#snippet trigger(attrs)}
				<button type="button" {...attrs} class="action-btn" data-testid="person-more"
					><Ellipsis class="h-3.5 w-3.5" aria-hidden="true" />More</button
				>
			{/snippet}
			{#if !marks.isReadOnly}<button
					type="button"
					role="menuitem"
					onclick={toggleMe}
					class={menuItem}
					data-testid="self-toggle"
					><User class="h-3.5 w-3.5" />{isMe ? 'Not me' : 'This is me'}</button
				>{/if}
			{#if canMerge}<button
					type="button"
					role="menuitem"
					onclick={() => (isMerging = true)}
					class={menuItem}
					data-testid="merge-person"><Combine class="h-3.5 w-3.5" />Merge…</button
				>{/if}
			{#if canMakeSubtree}<button
					type="button"
					role="menuitem"
					onclick={() => {
						subtreeError = null;
						isMakingSubtree = true;
					}}
					class={menuItem}
					data-testid="make-subtree"><Network class="h-3.5 w-3.5" />Make sub-tree from here…</button
				>{/if}
			{#if canChange}<button
					type="button"
					role="menuitem"
					onclick={() => editor.requestDeletePerson(dto.person.id)}
					class="{menuItem} border-t border-stone-200 text-red-700"
					><Trash2 class="h-3.5 w-3.5" />Delete…</button
				>{/if}
		</Popover>
	{/if}
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

{#if canMakeSubtree}
	<SubtreeDialog
		isOpen={isMakingSubtree}
		mode="create"
		initialName={subtreeSuggestion}
		rootName={dto.person.displayName}
		isSaving={isSavingSubtree}
		error={subtreeError}
		onclose={() => (isMakingSubtree = false)}
		onsave={makeSubtree}
	/>
{/if}
