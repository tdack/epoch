<script lang="ts">
	import { untrack } from 'svelte';
	import {
		CITATION_QUALITY_LABELS,
		isCitationQuality,
		type CitationDto,
		type CitationInput,
		type CitationQuality
	} from '#lib/shared/evidence.js';
	import type { TreeRole } from '#lib/shared/roles.js';
	import SourcePicker from './SourcePicker.svelte';
	import { canCite } from './evidence-permissions.js';

	interface Props {
		treeId: string;
		/** Prefix for element ids, so the dialog's fields do not collide with the page's. */
		idPrefix: string;
		role: TreeRole | undefined;
		/** True while the dialog is open; the section starts closed and empty each time. */
		isOpen: boolean;
		/** The record's existing citations, listed when editing. They are changed on the page. */
		existing?: CitationDto[];
		/**
		 * Called with what to cite with the save, or null for none. Empty or closed means no citation,
		 * so a record is never forced to carry one.
		 */
		onchange: (citation: CitationInput | null) => void;
		onerror: (message: string | null) => void;
	}

	let { treeId, idPrefix, role, isOpen, existing = [], onchange, onerror }: Props = $props();

	const field =
		'w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 coarse:text-base';
	const QUALITY_CHOICES = (Object.keys(CITATION_QUALITY_LABELS) as unknown as string[])
		.map(Number)
		.sort((a, b) => b - a) as CitationQuality[];

	let isDisclosed = $state(false);
	let sourceId = $state<string | null>(null);
	let sourceName = $state('');
	let page = $state('');
	let quality = $state('');

	$effect(() => {
		if (!isOpen) return;
		untrack(() => {
			isDisclosed = false;
			sourceId = null;
			sourceName = '';
			page = '';
			quality = '';
		});
	});

	// A section that is closed, or has no source chosen, cites nothing even if a page was typed.
	$effect(() => {
		if (!isDisclosed || sourceId === null) {
			onchange(null);
			return;
		}
		const parsed = quality === '' ? null : Number(quality);
		onchange({
			sourceId,
			page: page.trim() || null,
			quality: isCitationQuality(parsed) ? parsed : null
		});
	});
</script>

{#if canCite(role)}
	<details bind:open={isDisclosed} class="rounded-lg border border-stone-200 px-3 py-2">
		<summary class="cursor-pointer text-sm font-semibold text-emerald-900 coarse:min-h-11"
			>{existing.length > 0 ? 'Add another source' : 'Source (optional)'}</summary
		>
		<div class="mt-3 space-y-3">
			{#if existing.length > 0}
				<ul class="space-y-1 text-xs text-stone-700" data-testid="existing-sources">
					{#each existing as item (item.id)}
						<li>
							<span class="font-semibold text-stone-900">{item.sourceLabel}</span
							>{#if item.page}{' · '}{item.page}{/if}
						</li>
					{/each}
				</ul>
			{/if}
			<SourcePicker {treeId} {idPrefix} bind:sourceId bind:sourceName {onerror} />
			{#if sourceId}
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="{idPrefix}-page" class="field-label">Where in it</label>
						<input
							id="{idPrefix}-page"
							type="text"
							bind:value={page}
							class={field}
							placeholder="e.g. page 12, entry 4"
						/>
					</div>
					<div>
						<label for="{idPrefix}-quality" class="field-label">How reliable is it</label>
						<select id="{idPrefix}-quality" bind:value={quality} class={field}>
							<option value="">Not stated</option>
							{#each QUALITY_CHOICES as choice (choice)}
								<option value={String(choice)}>{CITATION_QUALITY_LABELS[choice]}</option>
							{/each}
						</select>
					</div>
				</div>
			{/if}
		</div>
	</details>
{/if}
