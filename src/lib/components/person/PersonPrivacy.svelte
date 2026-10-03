<script lang="ts">
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import { setPersonPrivacyApi } from '#lib/services/tree-api.js';
	import type { PersonPrivacy } from '#lib/shared/privacy.js';
	import type { PersonPageDto } from '#lib/shared/person-page.js';

	interface Props {
		dto: PersonPageDto;
		treeId: string;
		editor: TreeEditor;
	}

	let { dto, treeId, editor }: Props = $props();

	const PRIVACY_CHOICES: Array<{ value: PersonPrivacy; label: string }> = [
		{ value: 'auto', label: 'Automatic: follow their dates' },
		{ value: 'public', label: 'Always public' },
		{ value: 'private', label: 'Always private' }
	];
	/** What contributors and viewers get, in a sentence, so the setting's effect is not a guess. */
	const privacyEffect = $derived.by(() => {
		if (!dto.privacy) return '';
		if (dto.privacy.setting === 'public') return 'Contributors and viewers can see them.';
		if (dto.privacy.setting === 'private') return 'Hidden from contributors and viewers.';
		return dto.privacy.isLikelyLiving
			? 'Hidden from contributors and viewers, except the contributor who added them: no death is recorded and no birth is old enough.'
			: 'Visible to contributors and viewers: a death is recorded or their birth is old enough.';
	});
	let isSavingPrivacy = $state(false);

	async function changePrivacy(event: Event) {
		const privacy = (event.currentTarget as HTMLSelectElement).value as PersonPrivacy;
		isSavingPrivacy = true;
		await editor.mutate(
			() => setPersonPrivacyApi(treeId, dto.person.id, privacy, dto.person.version),
			{ done: 'Privacy changed', failure: 'Could not change the privacy' }
		);
		isSavingPrivacy = false;
	}
</script>

{#if dto.privacy}
	<div class="flex flex-wrap items-center gap-3 text-sm">
		<label for="person-privacy" class="sr-only">Who may see this person</label>
		<select
			id="person-privacy"
			value={dto.privacy.setting}
			onchange={changePrivacy}
			disabled={isSavingPrivacy}
			class="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm"
		>
			{#each PRIVACY_CHOICES as choice (choice.value)}<option value={choice.value}
					>{choice.label}</option
				>{/each}
		</select>
		<p class="text-xs text-stone-600" data-testid="privacy-effect">{privacyEffect}</p>
	</div>
{/if}
