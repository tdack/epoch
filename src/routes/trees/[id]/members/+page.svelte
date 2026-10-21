<script lang="ts">
	import TreeAdminTabs from '#lib/components/layout/TreeAdminTabs.svelte';
	import { treePath } from '#lib/shared/tree-slug.js';
	import { untrack } from 'svelte';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import {
		changeMemberRoleApi,
		fetchMembers,
		inviteMemberApi,
		removeMemberApi,
		withdrawInvitationApi
	} from '#lib/api/members.js';
	import { describeRole } from '#lib/shared/membership-policy.js';
	import type { TreeRole } from '#lib/shared/roles.js';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	const { toasts } = getTreeContext();
	const treeId = $derived(data.summary.tree.id);

	// Seeded from the load; every change below refetches, so the versions sent back are current.
	let members = $state(untrack(() => data.members));
	let email = $state('');
	let inviteRole = $state<TreeRole>(untrack(() => data.members.grantableRoles.at(-1) ?? 'viewer'));
	let isBusy = $state(false);
	let removing = $state<string | null>(null);
	// A role changes what someone else can see and do, so the select only proposes it (ADR-075).
	let proposedRole = $state<{ userId: string; role: TreeRole } | null>(null);
	// A refused role change leaves the select showing the choice that was refused, because the stored
	// role did not change and so nothing re-rendered it; keying the list on each reload resets it.
	let reloads = $state(0);

	const formatDate = (iso: string) =>
		new Date(iso).toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});

	/** `done` is the toast on success, unless the action returns its own message. */
	async function run(action: () => Promise<unknown>, done: string) {
		if (isBusy) return;
		isBusy = true;
		try {
			const result = await action();
			toasts.push(typeof result === 'string' ? result : done);
		} catch (cause) {
			toasts.push(messageOf(cause, 'That did not work'), { tone: 'error' });
		} finally {
			// Always reload: a refused change usually means someone else changed the list first.
			members = await fetchMembers(treeId).catch(() => members);
			removing = null;
			proposedRole = null;
			reloads += 1;
			isBusy = false;
		}
	}

	function invite(event: SubmitEvent) {
		event.preventDefault();
		const address = email.trim();
		if (!address) return;
		void run(async () => {
			const invitation = await inviteMemberApi(treeId, address, inviteRole);
			email = '';
			return invitation.wasEmailSent
				? `Invited ${address} — email sent`
				: `Invited ${address} — the email could not be sent; let them know yourself`;
		}, `Invited ${address}`);
	}
</script>

<svelte:head>
	<title>Members · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<TreeAdminTabs
	base={treePath({ ...data.summary.tree, subtree: null })}
	current="members"
	role={data.summary.viewer.role}
/>
<h2 class="text-2xl font-bold text-stone-900">Members</h2>
<!-- The Make/Cancel buttons appear beside the select with no focus move, so say so. -->
<p class="sr-only" aria-live="polite">
	{#if proposedRole}
		{@const proposed = members.members.find((m) => m.userId === proposedRole!.userId)}
		Confirm the change: make {proposed?.email}
		{proposedRole.role}.
	{/if}
</p>
<p class="mt-1 max-w-prose text-sm text-stone-600">
	An invitation gives an email address a role here and is emailed to that address. The role is taken
	up when that person next signs in with it. Cloudflare Access is a separate gate: the address must
	also be allowed by the Access policy for this app.
</p>

<section
	class="mt-6 max-w-3xl rounded-xl border border-stone-200 bg-white p-5"
	aria-labelledby="invite-heading"
>
	<h3 id="invite-heading" class="text-sm font-semibold text-stone-800">Invite someone</h3>
	<form onsubmit={invite} class="mt-3 flex flex-wrap items-end gap-3">
		<div>
			<label for="invite-email" class="block text-xs font-semibold text-stone-700"
				>Email address</label
			>
			<input
				id="invite-email"
				type="email"
				required
				bind:value={email}
				autocomplete="off"
				class="mt-1 w-72 rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
			/>
		</div>
		<div>
			<label for="invite-role" class="block text-xs font-semibold text-stone-700">Role</label>
			<select
				id="invite-role"
				bind:value={inviteRole}
				aria-describedby="invite-role-detail"
				class="mt-1 rounded-lg border border-stone-300 px-2 py-1.5 text-sm capitalize"
			>
				{#each members.grantableRoles as role (role)}<option value={role}>{role}</option>{/each}
			</select>
		</div>
		<button type="submit" disabled={isBusy || !email.trim()} class="btn-primary">Invite</button>
	</form>
	<p id="invite-role-detail" class="mt-3 max-w-2xl text-sm text-stone-600" aria-live="polite">
		{describeRole(inviteRole, data.summary.tree.name)}
	</p>
</section>

{#if members.invitations.length > 0}
	<section class="mt-6 max-w-3xl" aria-labelledby="pending-heading">
		<h3 id="pending-heading" class="text-sm font-semibold text-stone-800">
			Waiting to be taken up
		</h3>
		<ul class="mt-2 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
			{#each members.invitations as invitation (invitation.id)}
				<li
					class="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
					data-testid="invitation"
				>
					<span>
						<span class="font-medium text-stone-900">{invitation.email}</span>
						<span class="ml-2 text-stone-600 capitalize">{invitation.role}</span>
						<span class="ml-2 text-xs {invitation.isExpired ? 'text-red-700' : 'text-stone-500'}">
							{invitation.isExpired ? 'Expired' : 'Expires'}
							{formatDate(invitation.expiresAt)}
						</span>
					</span>
					<button
						type="button"
						disabled={isBusy}
						onclick={() =>
							run(() => withdrawInvitationApi(treeId, invitation.id), 'Invitation withdrawn')}
						class="rounded-lg border border-stone-300 px-3 py-1 text-xs font-semibold text-stone-700 disabled:opacity-50"
					>
						Withdraw
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<section class="mt-6 max-w-3xl" aria-labelledby="members-heading">
	<h3 id="members-heading" class="text-sm font-semibold text-stone-800">People with access</h3>
	<ul class="mt-2 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
		{#key reloads}
			{#each members.members as member (member.userId)}
				<li
					class="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm"
					data-testid="member"
				>
					<span class="min-w-0">
						<span class="font-medium text-stone-900">{member.name ?? member.email}</span>
						{#if member.isYou}<span class="ml-1 text-xs text-stone-500">(you)</span>{/if}
						{#if member.name}<span class="block truncate text-xs text-stone-600"
								>{member.email}</span
							>{/if}
					</span>
					{#if member.canManage}
						<span class="flex items-center gap-2">
							<label class="sr-only" for="role-{member.userId}">Role of {member.email}</label>
							<select
								id="role-{member.userId}"
								value={proposedRole?.userId === member.userId ? proposedRole.role : member.role}
								disabled={isBusy}
								onchange={(event) => {
									removing = null;
									const role = event.currentTarget.value as TreeRole;
									// Any other row's unconfirmed choice snaps back to its stored role through `value`.
									proposedRole = role === member.role ? null : { userId: member.userId, role };
								}}
								class="rounded-lg border border-stone-300 px-2 py-1 text-sm capitalize"
							>
								<!-- A member's present role stays listed even when the caller could not give it, so the box reads true. -->
								{#each [...new Set([member.role, ...members.grantableRoles])] as role (role)}
									<option value={role} disabled={!members.grantableRoles.includes(role)}
										>{role}</option
									>
								{/each}
							</select>
							{#if proposedRole?.userId === member.userId}
								{@const role = proposedRole.role}
								<button
									type="button"
									disabled={isBusy}
									onclick={() =>
										run(
											() => changeMemberRoleApi(treeId, member.userId, role, member.version),
											`${member.email} is now ${role}`
										)}
									class="rounded-lg bg-emerald-800 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
									>Make {role}</button
								>
								<button
									type="button"
									onclick={() => (proposedRole = null)}
									class="rounded-lg border border-stone-300 px-3 py-1 text-xs font-semibold text-stone-700"
									>Cancel</button
								>
							{:else if removing === member.userId}
								<button
									type="button"
									disabled={isBusy}
									onclick={() =>
										run(
											() => removeMemberApi(treeId, member.userId, member.version),
											`Removed ${member.email}`
										)}
									class="rounded-lg bg-red-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
									>Confirm remove</button
								>
								<button
									type="button"
									onclick={() => (removing = null)}
									class="rounded-lg border border-stone-300 px-3 py-1 text-xs font-semibold text-stone-700"
									>Cancel</button
								>
							{:else}
								<button
									type="button"
									disabled={isBusy}
									onclick={() => (removing = member.userId)}
									class="rounded-lg border border-stone-300 px-3 py-1 text-xs font-semibold text-stone-700 disabled:opacity-50"
									>Remove</button
								>
							{/if}
						</span>
					{:else}
						<span class="text-stone-600 capitalize">{member.role}</span>
					{/if}
				</li>
			{/each}
		{/key}
	</ul>
</section>
