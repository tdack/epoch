<script lang="ts">
	import { LogOut, RefreshCw } from '@lucide/svelte';
	import BaseModal from './BaseModal.svelte';
	import { isSameEmail, type LeaveBlockersDto } from '#lib/shared/profile.js';

	interface Props {
		isOpen: boolean;
		/** The person's own address, which they must type to confirm. */
		email: string;
		/** What stops them leaving; any blocker disables confirmation. */
		blockers: LeaveBlockersDto;
		/** Whether the request is in flight. */
		isLeaving?: boolean;
		/** The server's refusal, shown in the dialog. */
		error?: string | null;
		onclose: () => void;
		/** Called when the person confirms; the owner makes the request and signs them out. */
		onleave: () => void;
	}

	let {
		isOpen,
		email,
		blockers,
		isLeaving = false,
		error = null,
		onclose,
		onleave
	}: Props = $props();

	let typed = $state('');
	// Cleared on each opening so a cancelled attempt never leaves the button armed.
	$effect(() => {
		if (isOpen) typed = '';
	});

	const isBlocked = $derived(blockers.isInstallOwner || blockers.soleOwnerTrees.length > 0);
	const canLeave = $derived(!isBlocked && !isLeaving && isSameEmail(typed, email));
</script>

<BaseModal
	{isOpen}
	title="Leave Epoch"
	icon={LogOut}
	iconBgClass="bg-red-100"
	iconBorderClass="border-red-300"
	iconTextClass="text-red-700"
	{error}
	{onclose}
>
	<div class="space-y-4 text-sm text-stone-700">
		<div
			id="leave-warning"
			class="space-y-2 rounded-xl border border-red-300 bg-red-50 p-3.5 text-xs text-red-900"
		>
			<p class="font-bold">You cannot undo this yourself.</p>
			<ul class="list-disc space-y-1 pl-5 text-red-800">
				<li>
					You are removed from every tree, and your settings, favourites and picture are deleted.
				</li>
				<li>
					The changes you made stay in the trees' history under your name. Nothing else of yours is
					kept.
				</li>
				<li>
					You are signed out and turned away next time. Only a tree owner can invite you back, and
					you start afresh.
				</li>
			</ul>
		</div>

		{#if isBlocked}
			<div
				role="alert"
				class="space-y-1.5 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-900"
			>
				<p class="font-bold">You cannot leave yet.</p>
				{#if blockers.isInstallOwner}
					<p>You own this Epoch. Hand that over before leaving.</p>
				{/if}
				{#if blockers.soleOwnerTrees.length > 0}
					<p>You are the only owner of these trees. Make someone else an owner of each first:</p>
					<ul class="list-disc pl-5">
						{#each blockers.soleOwnerTrees as tree (tree.id)}
							<li>{tree.name}</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}

		<div>
			<label for="leave-confirm" class="mb-1 block text-xs font-medium text-stone-600">
				Type your email address <span class="font-bold text-red-700">{email}</span> to confirm
			</label>
			<input
				id="leave-confirm"
				type="email"
				autocomplete="off"
				bind:value={typed}
				placeholder={email}
				disabled={isBlocked || isLeaving}
				aria-describedby="leave-warning"
				class="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-xs text-stone-900 placeholder:text-stone-400 focus:border-red-500 focus:ring-1 focus:ring-red-500 focus:outline-none disabled:opacity-50"
			/>
		</div>

		<div class="flex justify-end space-x-2 border-t border-stone-200 pt-3">
			<button
				type="button"
				onclick={onclose}
				disabled={isLeaving}
				class="cursor-pointer rounded-lg px-4 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-200/60 hover:text-stone-900 disabled:opacity-50"
			>
				Cancel
			</button>
			<button
				type="button"
				onclick={onleave}
				disabled={!canLeave}
				aria-describedby="leave-warning"
				class="inline-flex cursor-pointer items-center space-x-1.5 rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
			>
				{#if isLeaving}
					<RefreshCw class="mr-1 h-3.5 w-3.5 animate-spin" />
					<span>Leaving...</span>
				{:else}
					<LogOut class="h-3.5 w-3.5" />
					<span>Leave Epoch</span>
				{/if}
			</button>
		</div>
	</div>
</BaseModal>
