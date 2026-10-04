<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Info, TriangleAlert } from 'lucide-svelte';
	import BaseModal from './BaseModal.svelte';
	import { groupRecords } from '#lib/shared/impact-groups.js';
	import type { ImpactSummary } from '#lib/types/genealogy.js';

	interface Props {
		/** Whether the dialog is open. */
		isOpen: boolean;
		/** Dialog title, e.g. "Delete Homer Simpson?". */
		title: string;
		/** What the server says the action would change; null while it is being fetched. */
		impact: ImpactSummary | null;
		/** True while the preview is being fetched. */
		isLoading?: boolean;
		/** True while the confirmed action is running. */
		isConfirming?: boolean;
		/** A failure to preview or to confirm. */
		error?: string | null;
		/** Label of the confirm button, e.g. "Delete person". */
		confirmLabel: string;
		/** Choices that decide what is previewed (which partnerships to merge), shown above the preview. */
		controls?: Snippet;
		/** Shown instead of the preview while `impact` is null and nothing is loading (an open choice). */
		idleMessage?: string;
		/** Disables the confirm button while a choice is still open, however complete the preview looks. */
		isConfirmBlocked?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
	}

	let {
		isOpen,
		title,
		impact,
		isLoading = false,
		isConfirming = false,
		error = null,
		confirmLabel,
		controls,
		idleMessage = 'Checking what this affects…',
		isConfirmBlocked = false,
		onconfirm,
		oncancel
	}: Props = $props();

	const GROUP_LABELS: Record<string, string> = {
		person: 'People',
		name: 'Names',
		union: 'Partnerships',
		partner: 'Partners in a partnership',
		link: 'Parent and child links',
		event: 'Events',
		media: 'Attachments',
		source: 'Sources',
		repository: 'Repositories',
		source_link: 'Where sources are kept',
		citation: 'Citations'
	};

	const ACTION_LABELS = { created: 'Added', updated: 'Changed', deleted: 'Deleted' } as const;

	// A moved record is listed once, as a move, not again as "Changed".
	const moves = $derived(impact?.moves ?? []);
	const movedIds = $derived(new Set(moves.map((m) => `${m.entityType}:${m.entityId}`)));
	const groups = $derived(
		impact
			? groupRecords(impact.records.filter((r) => !movedIds.has(`${r.entityType}:${r.entityId}`)))
			: []
	);
	const people = $derived(impact?.people ?? []);
	// Red is for deleting. A dialog that only adds or edits (a fact) is not styled as a warning, and
	// says a person's record changes, not their relationships, when no link or partnership does.
	const isDestructive = $derived(impact?.isDestructive ?? true);
	const hasRelationshipChanges = $derived(
		(impact?.records ?? []).some(
			(r) => r.entityType === 'link' || r.entityType === 'partner' || r.entityType === 'union'
		)
	);

	let cancelButton: HTMLButtonElement | null = $state(null);

	// Cancel takes focus first: a destructive dialog should not be confirmed by a stray Enter.
	$effect(() => {
		if (isOpen && cancelButton) cancelButton.focus();
	});
</script>

<BaseModal
	{isOpen}
	{title}
	icon={isDestructive ? TriangleAlert : Info}
	iconBgClass={isDestructive ? 'bg-red-100' : 'bg-emerald-100'}
	iconBorderClass={isDestructive ? 'border-red-300' : 'border-emerald-300'}
	iconTextClass={isDestructive ? 'text-red-700' : 'text-emerald-800'}
	maxWidthClass="max-w-lg"
	{error}
	onclose={oncancel}
>
	<div class="space-y-3">
		{@render controls?.()}
		{#if isLoading || !impact}
			<p class="text-sm text-stone-600" role="status">
				{isLoading ? 'Checking what this affects…' : idleMessage}
			</p>
		{:else}
			<p class="text-sm font-medium text-stone-800">This is exactly what will change:</p>

			{#if people.length > 0}
				<section aria-labelledby="impact-people">
					<h4 id="impact-people" class="text-xs font-bold tracking-wider text-stone-600 uppercase">
						People
					</h4>
					<ul class="mt-1 space-y-0.5 text-sm">
						{#each people as person (person.id)}
							<li>
								<span class="font-medium">{person.name}</span>
								<span
									class="text-xs {person.role === 'deleted'
										? 'font-semibold text-red-700'
										: 'text-stone-500'}"
								>
									{person.role === 'deleted'
										? 'will be deleted'
										: person.role === 'created'
											? 'will be added'
											: hasRelationshipChanges
												? 'stays, and their relationships change'
												: 'stays, and their record changes'}
								</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if moves.length > 0}
				<section aria-label="Moved records">
					<h4 class="text-xs font-bold tracking-wider text-stone-600 uppercase">Moved</h4>
					<ul class="mt-1 space-y-1 text-sm">
						{#each moves as move (move.entityType + move.entityId)}
							<li>
								<span class="text-xs font-semibold text-stone-500">Moved</span>
								{move.label}
								<span class="block pl-3 text-xs text-stone-500"
									>from the {move.from} to the {move.to}</span
								>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#each groups.filter((g) => g.entityType !== 'person') as group (group.entityType)}
				<section aria-label={GROUP_LABELS[group.entityType] ?? group.entityType}>
					<h4 class="text-xs font-bold tracking-wider text-stone-600 uppercase">
						{GROUP_LABELS[group.entityType] ?? group.entityType}
					</h4>
					<ul class="mt-1 space-y-0.5 text-sm">
						{#each group.records as record (record.entityType + record.entityId)}
							<li>
								<span
									class="text-xs font-semibold {record.action === 'deleted'
										? 'text-red-700'
										: 'text-stone-500'}">{ACTION_LABELS[record.action]}</span
								>
								{record.label}
							</li>
						{/each}
					</ul>
				</section>
			{/each}

			{#if impact.carriedCitations}
				<p class="text-sm text-stone-700">
					{impact.carriedCitations}
					{impact.carriedCitations === 1 ? 'citation stays' : 'citations stay'} with what {impact.carriedCitations ===
					1
						? 'it'
						: 'they'} support{impact.carriedCitations === 1 ? 's' : ''}. None is lost.
				</p>
			{/if}

			{#if impact.carriedNotes}
				<p class="text-sm text-stone-700">
					{impact.carriedNotes}
					{impact.carriedNotes === 1 ? 'note stays' : 'notes stay'} with what {impact.carriedNotes ===
					1
						? 'it is'
						: 'they are'} on. None is lost.
				</p>
			{/if}

			{#if groups.length === 0 && moves.length === 0}
				<p class="text-sm text-stone-600">Nothing would change.</p>
			{/if}
			<p class="text-xs text-stone-500">
				No other person or history is touched. You can undo this straight afterwards.
			</p>
		{/if}

		<div class="flex gap-2 pt-1">
			<button
				bind:this={cancelButton}
				type="button"
				onclick={oncancel}
				class="flex-1 cursor-pointer rounded-lg bg-stone-200 py-2 font-semibold text-stone-700 hover:bg-stone-300"
			>
				Cancel
			</button>
			<button
				type="button"
				onclick={onconfirm}
				disabled={isLoading || isConfirming || isConfirmBlocked || !impact}
				class="flex-1 cursor-pointer rounded-lg py-2 font-semibold text-white disabled:opacity-50 {isDestructive
					? 'bg-red-700 hover:bg-red-600'
					: 'bg-emerald-800 hover:bg-emerald-700'}"
			>
				{isConfirming ? 'Working…' : confirmLabel}
			</button>
		</div>
	</div>
</BaseModal>
