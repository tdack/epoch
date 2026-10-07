<script lang="ts">
	import { Trash2 } from '@lucide/svelte';
	import BaseModal from './BaseModal.svelte';
	import {
		RELATIVE_OUTCOMES,
		type RelativeAction,
		type RelativeOutcome
	} from '#lib/components/tree/tree-editor.svelte.js';

	interface Props {
		/** The relative to ask about; null keeps the dialog closed. */
		action: RelativeAction | null;
		onchoose: (outcome: RelativeOutcome) => void;
		oncancel: () => void;
	}

	let { action, onchoose, oncancel }: Props = $props();

	interface Choice {
		outcome: RelativeOutcome;
		label: string;
		detail: string;
		isDestructive?: boolean;
	}

	const relative = $derived(action?.relative.givenName ?? 'this person');
	const owner = $derived(action?.owner.givenName ?? 'this person');

	const choices = $derived.by((): Choice[] => {
		if (!action) return [];
		const list: Choice[] = [];
		if (action.relation === 'partner') {
			list.push({
				outcome: RELATIVE_OUTCOMES.ENDED,
				label: 'Divorced or separated',
				detail: `Records that the partnership ended. ${relative} stays in the tree and so do any children.`
			});
		}
		if (!action.relative.isDeceased) {
			list.push({
				outcome: RELATIVE_OUTCOMES.DIED,
				label: 'Died',
				detail: `Records ${relative} as deceased. A death never ends a partnership or removes a link.`
			});
		}
		if (action.relation === 'partner') {
			list.push({
				outcome: RELATIVE_OUTCOMES.REMOVE,
				label: 'Not a partner (recorded by mistake)',
				detail: `Takes ${relative} out of this partnership only. You see what changes before it is saved.`
			});
		} else if (action.relation === 'parent' || action.relation === 'child') {
			const link =
				action.relation === 'parent'
					? `${relative} as ${owner}’s parent`
					: `${relative} as ${owner}’s child`;
			list.push({
				outcome: RELATIVE_OUTCOMES.REMOVE,
				label: 'Not related (recorded by mistake)',
				detail: `Removes the link that records ${link}. Both people stay in the tree.`
			});
		}
		list.push({
			outcome: RELATIVE_OUTCOMES.DELETE,
			label: `Delete ${relative} from the tree`,
			detail:
				'Removes the person and everything only they hold. You see exactly what goes before confirming.',
			isDestructive: true
		});
		return list;
	});
</script>

<BaseModal
	isOpen={action !== null}
	title={`What happened with ${relative}?`}
	subtitle={action ? `Listed as ${owner}’s ${action.relation}` : null}
	icon={Trash2}
	iconBgClass="bg-stone-100"
	iconBorderClass="border-stone-300"
	iconTextClass="text-stone-700"
	onclose={oncancel}
>
	<div class="space-y-2" role="group" aria-label="What happened">
		{#each choices as choice (choice.outcome)}
			<button
				type="button"
				onclick={() => onchoose(choice.outcome)}
				class="w-full cursor-pointer rounded-lg border p-3 text-left transition-colors {choice.isDestructive
					? 'border-red-200 bg-red-50/60 hover:bg-red-100'
					: 'border-stone-300 bg-white hover:border-emerald-500'}"
			>
				<span
					class="block text-sm font-semibold {choice.isDestructive
						? 'text-red-800'
						: 'text-stone-900'}">{choice.label}</span
				>
				<span class="block text-xs text-stone-600">{choice.detail}</span>
			</button>
		{/each}
		{#if action?.relation === 'sibling'}
			<p class="text-[11px] text-stone-500">
				A sibling is someone who shares a parent, so there is no link to remove here. To separate
				them, remove the shared parent from one of them.
			</p>
		{/if}
	</div>
	<button
		type="button"
		onclick={oncancel}
		class="w-full cursor-pointer rounded-lg bg-stone-200 py-2 font-semibold text-stone-700"
		>Cancel</button
	>
</BaseModal>
