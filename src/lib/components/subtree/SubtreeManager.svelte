<script lang="ts">
	import {
		ArrowDown,
		ArrowUp,
		Eye,
		EyeOff,
		Network,
		Pencil,
		Trash2,
		UserRoundCog
	} from '@lucide/svelte';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import BaseModal from '#lib/components/modals/BaseModal.svelte';
	import PersonPicker from '#lib/components/PersonPicker.svelte';
	import type { Changed } from '#lib/api/client.js';
	import { undoApi } from '#lib/api/relationships.js';
	import { deleteSubtree, updateSubtree } from '#lib/api/subtrees.js';
	import type { SubtreeDto, UpdateSubtreeInput } from '#lib/shared/subtrees.js';
	import { subtreePath, type TreeRef } from '#lib/shared/tree-slug.js';
	import SubtreeDialog from './SubtreeDialog.svelte';

	interface Props {
		tree: TreeRef;
		/** In `position` order. */
		subtrees: SubtreeDto[];
		/** Root people's names by id; a root with no entry is shown by its state, not a name. */
		rootNames: Record<string, string>;
		/** Whether the viewer may change sub-trees (`tree:manage_subtrees`); otherwise the list is read-only. */
		canManage: boolean;
		toasts: ToastStore;
		/** Called after any change or undo, so the owner can reload what lists the sub-trees. */
		onchanged: () => Promise<void> | void;
	}

	let { tree, subtrees, rootNames, canManage, toasts, onchanged }: Props = $props();

	type Dialog = 'edit' | 'root' | 'delete' | null;
	let dialog = $state<Dialog>(null);
	let target = $state<SubtreeDto | null>(null);
	let isBusy = $state(false);
	let dialogError = $state<string | null>(null);
	let newRoot = $state<{ id: string; name: string } | null>(null);

	function open(kind: Exclude<Dialog, null>, subtree: SubtreeDto) {
		target = subtree;
		dialogError = null;
		isBusy = false;
		newRoot = null;
		dialog = kind;
	}
	const close = () => (dialog = null);

	async function undo() {
		try {
			const { undone } = await undoApi(tree.id);
			await onchanged();
			toasts.push(`Undid: ${undone.summary}`);
		} catch (cause) {
			toasts.push(messageOf(cause, 'Could not undo'), { tone: 'error', durationMs: 10_000 });
		}
	}

	/** Runs a write and reports it with Undo. Answers whether it worked. */
	async function apply(work: () => Promise<Changed>, done: string): Promise<boolean> {
		isBusy = true;
		dialogError = null;
		try {
			const { change } = await work();
			dialog = null;
			await onchanged();
			toasts.push(change?.summary ?? done, {
				action: change?.isUndoable ? { label: 'Undo', run: undo } : undefined
			});
			return true;
		} catch (cause) {
			dialogError = messageOf(cause, 'That did not work');
			return false;
		} finally {
			isBusy = false;
		}
	}

	const patch = (subtree: SubtreeDto, input: UpdateSubtreeInput, done: string) =>
		apply(() => updateSubtree(tree.id, subtree.id, { ...input, version: subtree.version }), done);

	/**
	 * Swaps positions with the neighbour: a position is a plain integer with gaps (deletes leave
	 * them), so setting one value could tie with a third sub-tree and order by row. Two writes make
	 * two changes, and Undo would revert only the last, leaving a tie, so a move offers none.
	 */
	async function move(subtree: SubtreeDto, by: -1 | 1) {
		const neighbour = subtrees[subtrees.indexOf(subtree) + by];
		if (isBusy || !neighbour) return;
		const didMove = await apply(async () => {
			await updateSubtree(tree.id, subtree.id, {
				position: neighbour.position,
				version: subtree.version
			});
			return updateSubtree(tree.id, neighbour.id, {
				position: subtree.position,
				version: neighbour.version
			}).then(() => ({ change: null }));
		}, 'Sub-tree moved');
		// A move has no dialog to hold the refusal, so it goes to the toast.
		if (!didMove && dialogError) toasts.push(dialogError, { tone: 'error' });
	}

	const rootLabel = (s: SubtreeDto) =>
		s.isRootMissing ? null : (rootNames[s.rootPersonId] ?? 'A person you cannot see');
	const actionClass =
		'inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-stone-700 focus-ring hover:bg-stone-200/70 disabled:cursor-default disabled:opacity-50 coarse:min-h-11';
</script>

<section
	id="subtrees-tab"
	class="scroll-mt-20"
	aria-labelledby="subtrees-heading"
	data-testid="subtree-manager"
>
	<h2 id="subtrees-heading" class="text-2xl font-bold text-stone-900">Sub-trees</h2>
	<p class="mt-1 max-w-prose text-sm text-stone-600">
		A sub-tree is a view of one person's descendants and their partners, opened from the tree
		switcher. It narrows lists and the chart; it hides nothing. On a public tree, visitors who are
		not signed in see only the sub-trees marked public.
		{#if canManage}Make one from a person's page.{/if}
	</p>

	{#if subtrees.length === 0}
		<p class="mt-4 text-sm text-stone-600" data-testid="subtrees-empty">No sub-trees yet.</p>
	{:else}
		<ul
			class="mt-4 divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white shadow-xs"
		>
			{#each subtrees as subtree, i (subtree.id)}
				<li
					class="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
					data-subtree={subtree.slug}
				>
					<div class="min-w-0">
						<span
							class="inline-flex flex-wrap items-center gap-2 text-sm font-semibold text-stone-900"
						>
							<Network class="h-3.5 w-3.5 text-stone-500" aria-hidden="true" />
							<a href={subtreePath(tree, subtree.slug)} class="hover:underline">{subtree.name}</a>
							{#if subtree.isPublic}
								<span
									class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900"
									>Public</span
								>
							{/if}
							{#if subtree.isRootMissing}
								<span
									class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900"
									>Anchor missing</span
								>
							{/if}
						</span>
						<p class="text-xs text-stone-600">
							{#if subtree.isRootMissing}
								The anchor person was deleted. Undoing that restores it, or choose another anchor.
							{:else}
								Anchored at {rootLabel(subtree)} · <span class="font-mono">~{subtree.slug}</span>
							{/if}
						</p>
					</div>
					{#if canManage}
						<div class="flex flex-wrap justify-end gap-1">
							<button
								type="button"
								class={actionClass}
								disabled={isBusy || i === 0}
								onclick={() => move(subtree, -1)}
							>
								<ArrowUp class="h-3.5 w-3.5" aria-hidden="true" />
								Move up<span class="sr-only"> {subtree.name}</span>
							</button>
							<button
								type="button"
								class={actionClass}
								disabled={isBusy || i === subtrees.length - 1}
								onclick={() => move(subtree, 1)}
							>
								<ArrowDown class="h-3.5 w-3.5" aria-hidden="true" />
								Move down<span class="sr-only"> {subtree.name}</span>
							</button>
							<button type="button" class={actionClass} onclick={() => open('edit', subtree)}>
								<Pencil class="h-3.5 w-3.5" aria-hidden="true" />
								Rename<span class="sr-only"> {subtree.name}</span>
							</button>
							<button
								type="button"
								class={actionClass}
								disabled={isBusy}
								onclick={() =>
									patch(
										subtree,
										{ isPublic: !subtree.isPublic },
										subtree.isPublic ? 'Sub-tree is members only' : 'Sub-tree is public'
									)}
							>
								{#if subtree.isPublic}
									<EyeOff class="h-3.5 w-3.5" aria-hidden="true" />
									Hide from visitors<span class="sr-only"> {subtree.name}</span>
								{:else}
									<Eye class="h-3.5 w-3.5" aria-hidden="true" />
									Show to visitors<span class="sr-only"> {subtree.name}</span>
								{/if}
							</button>
							<button type="button" class={actionClass} onclick={() => open('root', subtree)}>
								<UserRoundCog class="h-3.5 w-3.5" aria-hidden="true" />
								Change anchor<span class="sr-only"> of {subtree.name}</span>
							</button>
							<button
								type="button"
								class="{actionClass} text-red-700"
								onclick={() => open('delete', subtree)}
							>
								<Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
								Delete<span class="sr-only"> {subtree.name}</span>
							</button>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

{#if canManage && target}
	<SubtreeDialog
		isOpen={dialog === 'edit'}
		mode="edit"
		initialName={target.name}
		initialSlug={target.slug}
		isSaving={isBusy}
		error={dialogError}
		onclose={close}
		onsave={(name, slug) =>
			patch(target!, { name, ...(slug === target!.slug ? {} : { slug }) }, 'Sub-tree saved')}
	/>

	<BaseModal
		isOpen={dialog === 'root'}
		title="Change Anchor"
		icon={UserRoundCog}
		error={dialogError}
		onclose={close}
	>
		<form
			class="space-y-4"
			onsubmit={(e) => {
				e.preventDefault();
				if (newRoot) void patch(target!, { rootPersonId: newRoot.id }, 'Anchor changed');
			}}
		>
			<p class="text-sm text-stone-700">
				Choose the person {target.name} is anchored at.
			</p>
			<PersonPicker
				treeId={tree.id}
				label="New anchor"
				picked={newRoot}
				onpick={(p) => (newRoot = p)}
			/>
			<div class="flex justify-end space-x-2 border-t border-stone-200 pt-2">
				<button
					type="button"
					onclick={close}
					disabled={isBusy}
					class="cursor-pointer rounded-lg px-4 py-2 text-xs font-medium text-stone-600 hover:bg-stone-200/60 disabled:opacity-50"
					>Cancel</button
				>
				<button type="submit" disabled={isBusy || !newRoot} class="btn-primary"
					>Change anchor</button
				>
			</div>
		</form>
	</BaseModal>

	<BaseModal
		isOpen={dialog === 'delete'}
		title="Delete Sub-tree"
		icon={Trash2}
		iconBgClass="bg-red-100"
		iconBorderClass="border-red-300"
		iconTextClass="text-red-800"
		error={dialogError}
		onclose={close}
	>
		<div class="space-y-4">
			<p class="text-sm text-stone-700">
				Delete the sub-tree <span class="font-semibold">{target.name}</span>? Nobody in the tree is
				deleted, and you can undo this straight afterwards.
			</p>
			<div class="flex justify-end space-x-2 border-t border-stone-200 pt-2">
				<button
					type="button"
					onclick={close}
					disabled={isBusy}
					class="cursor-pointer rounded-lg px-4 py-2 text-xs font-medium text-stone-600 hover:bg-stone-200/60 disabled:opacity-50"
					>Cancel</button
				>
				<button
					type="button"
					disabled={isBusy}
					class="btn-primary"
					data-testid="confirm-delete-subtree"
					onclick={() =>
						apply(() => deleteSubtree(tree.id, target!.id, target!.version), 'Sub-tree deleted')}
					>Delete sub-tree</button
				>
			</div>
		</div>
	</BaseModal>
{/if}
